import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/id.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import { ensureStepUp, requireAuthed } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

function isUniqueError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ *
 * FR-7.1 — Pedal catalog CRUD
 * ------------------------------------------------------------------ */

const pedalSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  aliases: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  extensions: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\.[A-Za-z0-9]{1,10}$/, "Extensions look like .hlx"),
    )
    .max(10)
    .default([]),
  firmwareNotes: z.string().trim().max(2000).nullish(),
  importInstructionsMd: z.string().max(10000).default(""),
  validationMode: z.enum(["DEEP_JSON", "SYSEX", "FIXED_BINARY", "SHALLOW", "CLOUD_LINK"]),
  maxPresetBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024)
    .default(1048576),
  maxBundleBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024)
    .default(20971520),
  maxCompanionBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024)
    .default(5242880),
  enabled: z.boolean().default(true),
});

function serializePedalAdmin(row: Record<string, unknown>, presetCount: number) {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    slug: row.slug,
    aliases: row.aliases,
    extensions: row.extensions,
    validationMode: row.validationMode,
    firmwareNotes: row.firmwareNotes ?? null,
    importInstructionsMd: row.importInstructionsMd,
    maxPresetBytes: row.maxPresetBytes,
    maxBundleBytes: row.maxBundleBytes,
    maxCompanionBytes: row.maxCompanionBytes,
    enabled: row.enabled,
    presetCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

adminRouter.get("/pedals", async (_req, res) => {
  const rows = await prisma.pedal.findMany({ orderBy: [{ brand: "asc" }, { model: "asc" }] });
  const pedals = await Promise.all(
    rows.map(async (row) =>
      serializePedalAdmin(
        row,
        await prisma.preset.count({ where: { pedalId: row.id, status: "PUBLISHED" } }),
      ),
    ),
  );
  res.json({ pedals });
});

adminRouter.post("/pedals", async (req, res) => {
  const { user } = requireAuthed(req);
  const body = await pedalSchema.parseAsync(req.body);
  const slug = `${slugify(body.brand)}-${slugify(body.model)}`;
  let pedal;
  try {
    pedal = await prisma.pedal.create({
      data: {
        id: newId(),
        brand: body.brand,
        model: body.model,
        slug,
        aliases: body.aliases,
        extensions: body.extensions,
        firmwareNotes: body.firmwareNotes ?? null,
        importInstructionsMd: body.importInstructionsMd,
        validationMode: body.validationMode,
        maxPresetBytes: body.maxPresetBytes,
        maxBundleBytes: body.maxBundleBytes,
        maxCompanionBytes: body.maxCompanionBytes,
        enabled: body.enabled,
      },
    });
  } catch (err) {
    if (isUniqueError(err)) {
      throw new ApiError(409, "PEDAL_SLUG_TAKEN", `A pedal with slug "${slug}" already exists`);
    }
    throw err;
  }
  await audit({
    actorId: user.id,
    action: "admin.pedal.create",
    target: String(pedal.id),
    meta: { slug },
    ip: clientIp(req),
  });
  res.status(201).json({ pedal: serializePedalAdmin(pedal, 0) });
});

adminRouter.patch("/pedals/:id", async (req, res) => {
  const { user } = requireAuthed(req);
  const id = String(req.params.id);
  const existing = await prisma.pedal.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "PEDAL_NOT_FOUND", "No such pedal");

  const body = await pedalSchema.partial().parseAsync(req.body);
  const data: Record<string, unknown> = { ...body };
  if (body.firmwareNotes !== undefined) data.firmwareNotes = body.firmwareNotes ?? null;
  if (body.brand !== undefined || body.model !== undefined) {
    const brand = body.brand ?? String(existing.brand);
    const model = body.model ?? String(existing.model);
    data.slug = `${slugify(brand)}-${slugify(model)}`;
  }

  let pedal;
  try {
    pedal = await prisma.pedal.update({ where: { id }, data });
  } catch (err) {
    if (isUniqueError(err)) {
      throw new ApiError(409, "PEDAL_SLUG_TAKEN", "A pedal with that slug already exists");
    }
    throw err;
  }
  const presetCount = await prisma.preset.count({ where: { pedalId: id, status: "PUBLISHED" } });
  await audit({
    actorId: user.id,
    action: "admin.pedal.update",
    target: id,
    meta: { fields: Object.keys(body) },
    ip: clientIp(req),
  });
  res.json({ pedal: serializePedalAdmin(pedal, presetCount) });
});

/* ------------------------------------------------------------------ *
 * FR-7.2 — Moderation queue
 * ------------------------------------------------------------------ */

const reportStatusMap = { open: "OPEN", resolved: "RESOLVED", dismissed: "DISMISSED" } as const;

const reportQuerySchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]).default("open"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

async function buildReportRows(rows: Record<string, unknown>[]) {
  const presetIds = rows.filter((r) => r.targetType === "PRESET").map((r) => String(r.targetId));
  const commentIds = rows.filter((r) => r.targetType === "COMMENT").map((r) => String(r.targetId));

  const comments = commentIds.length
    ? await prisma.comment.findMany({ where: { id: { in: commentIds } } })
    : [];
  const commentById = new Map(comments.map((c) => [String(c.id), c]));

  const allPresetIds = [...new Set([...presetIds, ...comments.map((c) => String(c.presetId))])];
  const presets = allPresetIds.length
    ? await prisma.preset.findMany({ where: { id: { in: allPresetIds } } })
    : [];
  const presetById = new Map(presets.map((p) => [String(p.id), p]));

  const userIds = [
    ...new Set([
      ...rows.map((r) => String(r.reporterId)),
      ...presets.map((p) => String(p.userId)),
      ...comments.map((c) => String(c.userId)),
    ]),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } } })
    : [];
  const userById = new Map(users.map((u) => [String(u.id), u]));

  const owner = (id: string | null | undefined) => {
    const u = id ? userById.get(String(id)) : undefined;
    return u ? { id: u.id, displayName: u.displayName } : null;
  };

  return rows.map((r) => {
    const reporter = userById.get(String(r.reporterId));
    let target: Record<string, unknown>;
    if (r.targetType === "PRESET") {
      const p = presetById.get(String(r.targetId));
      target = p
        ? {
            type: "preset",
            id: p.id,
            title: p.title,
            status: String(p.status).toLowerCase(),
            owner: owner(p.userId),
          }
        : { type: "preset", id: r.targetId, missing: true };
    } else {
      const c = commentById.get(String(r.targetId));
      const preset = c ? presetById.get(String(c.presetId)) : undefined;
      target = c
        ? {
            type: "comment",
            id: c.id,
            excerpt: String(c.bodyMd ?? "").slice(0, 160),
            deleted: Boolean(c.deletedAt),
            preset: preset ? { id: preset.id, title: preset.title } : null,
            owner: owner(c.userId),
          }
        : { type: "comment", id: r.targetId, missing: true };
    }
    return {
      id: r.id,
      targetType: String(r.targetType).toLowerCase(),
      targetId: r.targetId,
      reason: r.reason,
      status: String(r.status).toLowerCase(),
      resolutionNote: r.resolutionNote ?? null,
      handledAt: r.handledAt ?? null,
      createdAt: r.createdAt,
      reporter: reporter ? { id: reporter.id, displayName: reporter.displayName } : null,
      target,
    };
  });
}

adminRouter.get("/reports", async (req, res) => {
  const { status, page, limit } = reportQuerySchema.parse(req.query);
  const where = { status: reportStatusMap[status] };
  const [total, open, resolved, dismissed, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.count({ where: { status: "OPEN" } }),
    prisma.report.count({ where: { status: "RESOLVED" } }),
    prisma.report.count({ where: { status: "DISMISSED" } }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.json({
    reports: await buildReportRows(rows),
    page,
    limit,
    total,
    counts: { open, resolved, dismissed },
  });
});

const resolveSchema = z.object({
  action: z.enum(["dismiss", "hide", "remove"]),
  note: z.string().trim().max(500).optional(),
});

adminRouter.post("/reports/:id/resolve", async (req, res) => {
  const { user } = requireAuthed(req);
  await ensureStepUp(req);
  const id = String(req.params.id);
  const body = await resolveSchema.parseAsync(req.body);

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new ApiError(404, "REPORT_NOT_FOUND", "No such report");
  if (report.status !== "OPEN") {
    throw new ApiError(409, "REPORT_ALREADY_HANDLED", "This report has already been handled");
  }

  const now = new Date();
  const note = body.note ?? (body.action === "dismiss" ? "Dismissed by moderator" : `Report ${id}`);

  if (body.action !== "dismiss") {
    if (report.targetType === "PRESET") {
      const preset = await prisma.preset.findUnique({ where: { id: String(report.targetId) } });
      if (!preset)
        throw new ApiError(404, "REPORT_TARGET_NOT_FOUND", "The reported preset no longer exists");
      if (body.action === "hide") {
        await prisma.preset.update({
          where: { id: preset.id },
          data: { status: "HIDDEN", statusReason: note },
        });
      } else {
        await prisma.preset.delete({ where: { id: preset.id } });
      }
    } else {
      const comment = await prisma.comment.findUnique({ where: { id: String(report.targetId) } });
      if (!comment)
        throw new ApiError(404, "REPORT_TARGET_NOT_FOUND", "The reported comment no longer exists");
      if (body.action === "hide") {
        await prisma.comment.update({ where: { id: comment.id }, data: { deletedAt: now } });
      } else {
        await prisma.comment.delete({ where: { id: comment.id } });
      }
    }
  }

  const status = body.action === "dismiss" ? "DISMISSED" : "RESOLVED";
  const updated = await prisma.report.update({
    where: { id },
    data: { status, handledBy: user.id, handledAt: now, resolutionNote: note },
  });

  await audit({
    actorId: user.id,
    action: "admin.report.resolve",
    target: id,
    meta: { action: body.action, targetType: report.targetType, targetId: report.targetId, status },
    ip: clientIp(req),
  });

  res.json({
    report: {
      id: updated.id,
      status: String(updated.status).toLowerCase(),
      action: body.action,
      resolutionNote: updated.resolutionNote,
      handledAt: updated.handledAt,
    },
  });
});

/* ------------------------------------------------------------------ *
 * FR-7.2 — User ban / unban
 * ------------------------------------------------------------------ */

const banSchema = z.object({
  type: z.enum(["hard", "shadow"]),
  reason: z.string().trim().min(1).max(300),
});

adminRouter.post("/users/:id/ban", async (req, res) => {
  const { user } = requireAuthed(req);
  await ensureStepUp(req);
  const id = String(req.params.id);
  const body = await banSchema.parseAsync(req.body);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "No such user");
  if (id === user.id)
    throw new ApiError(400, "CANNOT_BAN_SELF", "Administrators cannot ban themselves");
  if (target.role === "ADMIN")
    throw new ApiError(403, "CANNOT_BAN_ADMIN", "Administrator accounts are protected");
  if (target.bannedAt)
    throw new ApiError(409, "USER_ALREADY_BANNED", "This user is already banned");

  const now = new Date();
  const banType = body.type === "hard" ? "HARD" : "SHADOW";
  await prisma.user.update({
    where: { id },
    data: { bannedAt: now, banType, banReason: body.reason },
  });

  if (banType === "HARD") {
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: now },
    });
  } else {
    await prisma.preset.updateMany({
      where: { userId: id, status: "PUBLISHED" },
      data: { status: "HIDDEN", statusReason: `Shadow banned: ${body.reason}` },
    });
  }

  await audit({
    actorId: user.id,
    action: "admin.user.ban",
    target: id,
    meta: { banType, reason: body.reason },
    ip: clientIp(req),
  });

  res.json({
    user: { id, banned: true, banType: String(banType).toLowerCase(), banReason: body.reason },
  });
});

adminRouter.post("/users/:id/unban", async (req, res) => {
  const { user } = requireAuthed(req);
  await ensureStepUp(req);
  const id = String(req.params.id);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "No such user");
  if (!target.bannedAt) throw new ApiError(409, "USER_NOT_BANNED", "This user is not banned");

  await prisma.user.update({
    where: { id },
    data: { bannedAt: null, banType: null, banReason: null },
  });

  await audit({ actorId: user.id, action: "admin.user.unban", target: id, ip: clientIp(req) });
  res.json({ user: { id, banned: false } });
});

/* ------------------------------------------------------------------ *
 * FR-7.3 — Stats dashboard
 * ------------------------------------------------------------------ */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

adminRouter.get("/stats", async (_req, res) => {
  const since = new Date(Date.now() - MONTH_MS);
  const [
    usersTotal,
    usersVerified,
    usersRecent,
    presets,
    downloadEvents,
    fileRows,
    comments,
    votes,
    openReports,
    recentSignups,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { verified: true } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.preset.findMany({ select: { status: true, pedalId: true, downloadCount: true } }),
    prisma.downloadEvent.count(),
    prisma.presetFile.findMany({ select: { size: true } }),
    prisma.comment.count({ where: { deletedAt: null } }),
    prisma.vote.count(),
    prisma.report.count({ where: { status: "OPEN" } }),
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, displayName: true, createdAt: true },
    }),
  ]);

  const pedalRows = await prisma.pedal.findMany({
    select: { id: true, brand: true, model: true },
  });
  const byPedal = new Map<string, { presets: number; downloads: number }>();
  const statusCounts: Record<string, number> = {
    draft: 0,
    quarantine: 0,
    published: 0,
    rejected: 0,
    hidden: 0,
  };
  let downloadsTotal = 0;
  for (const p of presets) {
    const key = String(p.pedalId);
    const bucket = byPedal.get(key) ?? { presets: 0, downloads: 0 };
    downloadsTotal += Number(p.downloadCount ?? 0);
    if (p.status === "PUBLISHED") bucket.presets += 1;
    bucket.downloads += Number(p.downloadCount ?? 0);
    byPedal.set(key, bucket);
    const sk = String(p.status).toLowerCase();
    statusCounts[sk] = (statusCounts[sk] ?? 0) + 1;
  }

  const storageBytes = fileRows.reduce((sum, f) => sum + Number(f.size ?? 0), 0);

  res.json({
    users: { total: usersTotal, verified: usersVerified, last30Days: usersRecent },
    presets: { total: presets.length, ...statusCounts },
    downloads: { total: downloadsTotal, events: downloadEvents },
    storage: { bytes: storageBytes, files: fileRows.length },
    engagement: { comments, votes, openReports },
    perPedal: pedalRows.map((p) => ({
      pedalId: p.id,
      brand: p.brand,
      model: p.model,
      presets: byPedal.get(String(p.id))?.presets ?? 0,
      downloads: byPedal.get(String(p.id))?.downloads ?? 0,
    })),
    recentSignups,
  });
});

/* ------------------------------------------------------------------ *
 * FR-7.4 — Tag governance
 * ------------------------------------------------------------------ */

const tagCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/, "Slug is lowercase letters, digits and dashes"),
  label: z.string().trim().min(1).max(60),
  blacklisted: z.boolean().default(false),
});

const tagUpdateSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/, "Slug is lowercase letters, digits and dashes")
    .optional(),
  label: z.string().trim().min(1).max(60).optional(),
  blacklisted: z.boolean().optional(),
});

adminRouter.get("/tags", async (_req, res) => {
  const rows = await prisma.tag.findMany({ orderBy: { label: "asc" } });
  const tags = await Promise.all(
    rows.map(async (t) => ({
      id: t.id,
      slug: t.slug,
      label: t.label,
      blacklisted: t.blacklisted,
      presetCount: await prisma.presetTag.count({ where: { tagId: t.id } }),
    })),
  );
  res.json({ tags });
});

adminRouter.post("/tags", async (req, res) => {
  const { user } = requireAuthed(req);
  const body = await tagCreateSchema.parseAsync(req.body);
  let tag;
  try {
    tag = await prisma.tag.create({
      data: { id: newId(), slug: body.slug, label: body.label, blacklisted: body.blacklisted },
    });
  } catch (err) {
    if (isUniqueError(err))
      throw new ApiError(409, "TAG_SLUG_TAKEN", "A tag with that slug already exists");
    throw err;
  }
  await audit({
    actorId: user.id,
    action: "admin.tag.create",
    target: String(tag.id),
    meta: { slug: body.slug },
    ip: clientIp(req),
  });
  res.status(201).json({
    tag: {
      id: tag.id,
      slug: tag.slug,
      label: tag.label,
      blacklisted: tag.blacklisted,
      presetCount: 0,
    },
  });
});

adminRouter.patch("/tags/:id", async (req, res) => {
  const { user } = requireAuthed(req);
  const id = String(req.params.id);
  const body = await tagUpdateSchema.parseAsync(req.body);
  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "TAG_NOT_FOUND", "No such tag");

  const wantsBlacklist = body.blacklisted === true && existing.blacklisted !== true;
  if (wantsBlacklist) await ensureStepUp(req);

  const data: Record<string, unknown> = { ...body };
  let tag;
  try {
    tag = await prisma.tag.update({ where: { id }, data });
  } catch (err) {
    if (isUniqueError(err))
      throw new ApiError(409, "TAG_SLUG_TAKEN", "A tag with that slug already exists");
    throw err;
  }

  let detached = 0;
  if (wantsBlacklist) {
    const result = await prisma.presetTag.deleteMany({ where: { tagId: id } });
    detached = result.count;
    await audit({
      actorId: user.id,
      action: "admin.tag.blacklist",
      target: id,
      meta: { slug: tag.slug, detached },
      ip: clientIp(req),
    });
  } else {
    await audit({
      actorId: user.id,
      action: "admin.tag.update",
      target: id,
      meta: { fields: Object.keys(body) },
      ip: clientIp(req),
    });
  }

  res.json({
    tag: { id: tag.id, slug: tag.slug, label: tag.label, blacklisted: tag.blacklisted },
    detached,
  });
});

const mergeSchema = z.object({ targetTagId: z.string().trim().min(1).max(80) });

adminRouter.post("/tags/:id/merge", async (req, res) => {
  const { user } = requireAuthed(req);
  await ensureStepUp(req);
  const sourceId = String(req.params.id);
  const { targetTagId } = await mergeSchema.parseAsync(req.body);

  if (sourceId === targetTagId)
    throw new ApiError(400, "TAG_MERGE_SELF", "Cannot merge a tag into itself");

  const [source, target] = await Promise.all([
    prisma.tag.findUnique({ where: { id: sourceId } }),
    prisma.tag.findUnique({ where: { id: targetTagId } }),
  ]);
  if (!source) throw new ApiError(404, "TAG_NOT_FOUND", "No such source tag");
  if (!target) throw new ApiError(404, "TAG_TARGET_NOT_FOUND", "No such target tag");

  const [sourceLinks, targetLinks] = await Promise.all([
    prisma.presetTag.findMany({ where: { tagId: sourceId } }),
    prisma.presetTag.findMany({ where: { tagId: targetTagId } }),
  ]);
  const alreadyLinked = new Set(targetLinks.map((l) => String(l.presetId)));

  let moved = 0;
  for (const link of sourceLinks) {
    if (alreadyLinked.has(String(link.presetId))) continue;
    await prisma.presetTag.create({
      data: { presetId: String(link.presetId), tagId: targetTagId },
    });
    moved += 1;
  }
  await prisma.presetTag.deleteMany({ where: { tagId: sourceId } });
  await prisma.tag.delete({ where: { id: sourceId } });

  await audit({
    actorId: user.id,
    action: "admin.tag.merge",
    target: sourceId,
    meta: { into: targetTagId, moved },
    ip: clientIp(req),
  });

  res.json({
    merged: {
      sourceId,
      sourceSlug: source.slug,
      targetId: targetTagId,
      targetSlug: target.slug,
      moved,
    },
  });
});
