import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/id.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import { getStorage } from "../lib/storage.js";
import { checkRate, rateLimited } from "../lib/rate-limit.js";
import {
  fileExt,
  isBundleExt,
  IR_EXTENSIONS,
  validateCloudLink,
  validatePresetFile,
  type ExtractedMeta,
  type PedalSpec,
} from "../lib/validators.js";
import { requireAuthed, requireUser } from "../middleware/auth.js";
import { hotScore, refreshPresetHotRank } from "../lib/hot-rank.js";
import { MARKDOWN_VERSION, renderMarkdown } from "../lib/markdown.js";
import {
  COMMENT_MIN_ACCOUNT_AGE_MS,
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_LINKS,
  serializeComment,
  type CommentRow,
} from "../lib/comments.js";

const HOUR_MS = 60 * 60 * 1000;

export const presetsRouter = Router();

// All mutations require a signed-in user; browsing and downloads are public.
presetsRouter.use((req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  requireUser(req, _res, next);
});

function limit(key: string, max: number, message: string): void {
  const result = checkRate(key, { windowMs: HOUR_MS, max });
  if (!result.allowed) rateLimited(result, message);
}

type PedalRow = {
  id: string;
  brand: string;
  model: string;
  slug: string;
  validationMode: string;
  extensions: string[];
  maxPresetBytes: number;
  maxBundleBytes: number;
  maxCompanionBytes: number;
  enabled: boolean;
};

function pedalSpec(pedal: PedalRow): PedalSpec {
  return {
    brand: pedal.brand,
    validationMode: pedal.validationMode,
    extensions: pedal.extensions,
    maxPresetBytes: pedal.maxPresetBytes,
    maxBundleBytes: pedal.maxBundleBytes,
    maxCompanionBytes: pedal.maxCompanionBytes,
  };
}

async function loadPedal(slug: string): Promise<PedalRow> {
  const pedal = await prisma.pedal.findUnique({ where: { slug } });
  if (!pedal || !pedal.enabled) {
    throw new ApiError(404, "PEDAL_NOT_FOUND", "No such pedal in the catalog");
  }
  return pedal as unknown as PedalRow;
}

function quarantineKeyOwnedBy(key: string, userId: string): boolean {
  return key.startsWith(`quarantine/${userId}/`);
}

function filenameFromKey(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readUpload(
  key: string,
  userId: string,
): Promise<{ bytes: Buffer; filename: string }> {
  if (!quarantineKeyOwnedBy(key, userId)) {
    throw new ApiError(403, "UPLOAD_KEY_NOT_OWNED", "That upload does not belong to you");
  }
  const bytes = await getStorage().get(key);
  if (!bytes) {
    throw new ApiError(
      404,
      "UPLOAD_NOT_FOUND",
      "That upload no longer exists — upload the file again",
    );
  }
  return { bytes, filename: filenameFromKey(key) };
}

const uploadUrlSchema = z.object({
  pedalSlug: z.string().min(1),
  filename: z.string().min(1).max(200),
  size: z.number().int().positive(),
  role: z.enum(["primary", "ir"]).default("primary"),
});

presetsRouter.post("/upload-url", async (req, res) => {
  const { user } = requireAuthed(req);
  limit(`upload-url:${user.id}`, 30, "Upload requests are limited to 30 per hour");
  const body = await uploadUrlSchema.parseAsync(req.body);
  const pedal = await loadPedal(body.pedalSlug);

  if (pedal.validationMode === "CLOUD_LINK") {
    throw new ApiError(
      400,
      "CLOUD_LINK_REQUIRED",
      "Quad Cortex presets are shared via a Cortex Cloud link — no file upload is needed",
    );
  }

  const ext = fileExt(body.filename);
  const allowed =
    body.role === "ir" ? [...IR_EXTENSIONS] : pedal.extensions.map((e) => e.toLowerCase());
  if (!ext || !allowed.includes(ext)) {
    throw new ApiError(
      400,
      "FILE_EXTENSION_NOT_ALLOWED",
      `.${ext || "?"} files are not accepted here (allowed: ${allowed.map((e) => "." + e).join(", ")})`,
    );
  }

  const cap =
    body.role === "ir"
      ? pedal.maxCompanionBytes
      : isBundleExt(ext)
        ? pedal.maxBundleBytes
        : pedal.maxPresetBytes;
  if (body.size > cap) {
    throw new ApiError(
      400,
      "FILE_SIZE_EXCEEDED",
      `File is larger than the ${cap} byte limit for this pedal`,
    );
  }

  const safeName = body.filename
    .replace(/[/\\]/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
  const key = `quarantine/${user.id}/${newId()}/${safeName}`;
  const put = await getStorage().presignPut(key, {
    maxBytes: cap,
    contentType: "application/octet-stream",
  });

  res.status(201).json({
    uploadId: newId(),
    key,
    url: put.url,
    headers: put.headers,
    expiresAt: put.expiresAt,
    maxBytes: cap,
  });
});

const inspectSchema = z.object({
  pedalSlug: z.string().min(1),
  key: z.string().min(1).max(400),
});

presetsRouter.post("/inspect", async (req, res) => {
  const { user } = requireAuthed(req);
  limit(`inspect:${user.id}`, 30, "File inspections are limited to 30 per hour");
  const body = await inspectSchema.parseAsync(req.body);
  const pedal = await loadPedal(body.pedalSlug);
  if (pedal.validationMode === "CLOUD_LINK") {
    throw new ApiError(
      400,
      "CLOUD_LINK_REQUIRED",
      "This pedal shares presets as Cortex Cloud links",
    );
  }

  const { bytes, filename } = await readUpload(body.key, user.id);
  const kind = isBundleExt(fileExt(filename)) ? "bundle" : "file";
  const result = validatePresetFile(pedalSpec(pedal), { filename, role: "primary", kind }, bytes);
  if (!result.ok) throw new ApiError(400, result.code, result.message);

  const contentHash = sha256(bytes);
  const duplicate = await prisma.preset.findFirst({
    where: { contentHash, status: "PUBLISHED" },
  });

  res.json({
    contentHash,
    size: bytes.length,
    kind,
    filename,
    extracted: result.extracted,
    duplicateOf: duplicate ? duplicate.id : null,
  });
});

const finalizeSchema = z
  .object({
    pedalSlug: z.string().min(1),
    section: z.enum(["general", "songs"]),
    title: z.string().trim().min(2).max(120),
    descriptionMd: z.string().trim().max(5000).default(""),
    songTitle: z.string().trim().max(200).optional(),
    artist: z.string().trim().max(200).optional(),
    album: z.string().trim().max(200).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    firmwareVersion: z.string().trim().min(1).max(40),
    kind: z.enum(["file", "cloud_link"]).default("file"),
    cloudUrl: z.string().trim().max(1000).optional(),
    files: z
      .array(
        z.object({
          key: z.string().min(1).max(400),
          role: z.enum(["primary", "ir"]).default("primary"),
        }),
      )
      .max(6)
      .default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
    usesThirdPartyIr: z.boolean().default(false),
    licenseAttested: z.literal(true),
    forkAck: z.boolean().default(false),
    status: z.enum(["draft", "published"]).default("published"),
  })
  .superRefine((body, ctx) => {
    if (body.section === "songs") {
      if (!body.songTitle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["songTitle"],
          message: "Songs presets need a song title",
        });
      }
      if (!body.artist) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artist"],
          message: "Songs presets need an artist",
        });
      }
    }
    if (body.section === "general" && body.tags.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tags"],
        message: "General presets need at least one tag",
      });
    }
    if (body.kind === "cloud_link" && !body.cloudUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cloudUrl"],
        message: "A Cortex Cloud URL is required",
      });
    }
    if (body.kind === "file") {
      const primaries = body.files.filter((f) => f.role === "primary");
      if (primaries.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files"],
          message: "Exactly one primary file is required",
        });
      }
      const seen = new Set<string>();
      for (const file of body.files) {
        if (seen.has(file.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["files"],
            message: "Each uploaded file can only be attached once",
          });
          break;
        }
        seen.add(file.key);
      }
    }
  });

type FinalizeBody = z.infer<typeof finalizeSchema>;

type LoadedFile = {
  key: string;
  role: "primary" | "ir";
  filename: string;
  bytes: Buffer;
  ext: string;
  kind: "file" | "bundle";
  extracted: ExtractedMeta;
};

async function loadAndValidateFiles(
  pedal: PedalRow,
  body: FinalizeBody,
  userId: string,
): Promise<LoadedFile[]> {
  const out: LoadedFile[] = [];
  for (const entry of body.files) {
    const { bytes, filename } = await readUpload(entry.key, userId);
    const ext = fileExt(filename);
    const kind = entry.role === "primary" && isBundleExt(ext) ? "bundle" : "file";
    const result = validatePresetFile(
      pedalSpec(pedal),
      { filename, role: entry.role, kind },
      bytes,
    );
    if (!result.ok) throw new ApiError(400, result.code, result.message);
    out.push({ ...entry, filename, bytes, ext, kind, extracted: result.extracted });
  }
  return out;
}

async function resolveTags(slugs: string[]): Promise<string[]> {
  const unique = [...new Set(slugs.map((s) => s.toLowerCase()))];
  if (unique.length === 0) return [];
  const rows = await prisma.tag.findMany({ where: { slug: { in: unique } } });
  const found = new Set(rows.map((r) => r.slug));
  const missing = unique.filter((s) => !found.has(s));
  if (missing.length > 0) {
    throw new ApiError(
      400,
      "TAG_UNKNOWN",
      `Unknown tag${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    );
  }
  const blocked = rows.filter((r) => r.blacklisted).map((r) => r.slug);
  if (blocked.length > 0) {
    throw new ApiError(
      400,
      "TAG_BLACKLISTED",
      `Tag${blocked.length > 1 ? "s" : ""} removed by moderation: ${blocked.join(", ")}`,
    );
  }
  return rows.map((r) => r.id);
}

function serializePreset(
  preset: Record<string, unknown>,
  pedal: PedalRow,
  user: { id: string; displayName: string; verified: boolean },
  tags: { slug: string; label: string }[],
  files: Record<string, unknown>[],
) {
  return {
    id: preset.id,
    section: String(preset.section).toLowerCase(),
    title: preset.title,
    descriptionMd: preset.descriptionMd,
    songTitle: preset.songTitle ?? null,
    artist: preset.artist ?? null,
    album: preset.album ?? null,
    year: preset.year ?? null,
    firmwareVersion: preset.firmwareVersion,
    kind: String(preset.kind).toLowerCase(),
    cloudUrl: preset.cloudUrl ?? null,
    usesThirdPartyIr: preset.usesThirdPartyIr,
    version: preset.version,
    status: String(preset.status).toLowerCase(),
    contentHash: preset.contentHash ?? null,
    fileSize: preset.fileSize ?? null,
    fileExt: preset.fileExt ?? null,
    extractedMeta: preset.extractedMeta ?? null,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    pedal: { slug: pedal.slug, brand: pedal.brand, model: pedal.model },
    user,
    tags,
    files: files.map((f) => ({
      role: String(f.role).toLowerCase(),
      size: f.size,
      ext: f.ext,
      contentHash: f.contentHash,
    })),
  };
}

presetsRouter.post("/", async (req, res) => {
  const { user } = requireAuthed(req);
  limit(`create:${user.id}`, 10, "Publishing is limited to 10 presets per hour");
  const body = await finalizeSchema.parseAsync(req.body);
  const pedal = await loadPedal(body.pedalSlug);

  if (body.kind === "cloud_link") {
    if (pedal.validationMode !== "CLOUD_LINK") {
      throw new ApiError(
        400,
        "CLOUD_LINK_NOT_SUPPORTED",
        "This pedal accepts preset files, not Cortex Cloud links",
      );
    }
  } else if (pedal.validationMode === "CLOUD_LINK") {
    throw new ApiError(
      400,
      "CLOUD_LINK_REQUIRED",
      "Quad Cortex presets are shared via a Cortex Cloud link — no file upload is needed",
    );
  }

  let cloudUrl: string | null = null;
  if (body.kind === "cloud_link") {
    const link = validateCloudLink(body.cloudUrl ?? "");
    if (!link.ok) throw new ApiError(400, link.code, link.message);
    cloudUrl = link.url;
  }

  const files = body.kind === "file" ? await loadAndValidateFiles(pedal, body, user.id) : [];
  const primary = files.find((f) => f.role === "primary");

  let contentHash: string | null = null;
  if (primary) {
    contentHash = sha256(primary.bytes);
    if (!body.forkAck) {
      const duplicate = await prisma.preset.findFirst({
        where: { contentHash, status: "PUBLISHED" },
      });
      if (duplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_CONTENT",
          "A published preset with an identical file already exists — enable the fork/updated-version option if yours differs",
        );
      }
    }
  }

  const tagIds = await resolveTags(body.tags);
  const presetId = newId();
  const section = body.section === "general" ? "GENERAL" : "SONGS";
  const status = body.status === "draft" ? "DRAFT" : "PUBLISHED";

  // Move each validated object out of quarantine into its immutable published key.
  const moved: { from: string; to: string }[] = [];
  for (const [index, file] of files.entries()) {
    const slot = file.role === "primary" ? "primary" : `ir-${index}`;
    const to = `presets/${presetId}/v1/${slot}.${file.ext}`;
    await getStorage().move(file.key, to);
    moved.push({ from: file.key, to });
  }

  const primaryFile = primary ? moved.find((m) => m.from === primary.key) : undefined;

  const preset = await prisma.preset.create({
    data: {
      id: presetId,
      userId: user.id,
      pedalId: pedal.id,
      section,
      title: body.title,
      descriptionMd: body.descriptionMd,
      songTitle: body.songTitle ?? null,
      artist: body.artist ?? null,
      album: body.album ?? null,
      year: body.year ?? null,
      firmwareVersion: body.firmwareVersion,
      kind:
        body.kind === "cloud_link"
          ? "CLOUD_LINK"
          : files.some((f) => f.kind === "bundle")
            ? "BUNDLE"
            : "FILE",
      cloudUrl,
      contentHash,
      storageKey: primaryFile ? primaryFile.to : null,
      fileSize: primary ? primary.bytes.length : null,
      fileExt: primary ? primary.ext : null,
      extractedMeta: primary ? (primary.extracted as never) : Prisma.DbNull,
      usesThirdPartyIr: body.usesThirdPartyIr,
      version: 1,
      status,
    },
  });

  const fileRows: Record<string, unknown>[] = [];
  for (const file of files) {
    const movedKey = moved.find((m) => m.from === file.key)?.to;
    if (!movedKey) continue;
    const row = await prisma.presetFile.create({
      data: {
        id: newId(),
        presetId,
        presetVersion: 1,
        role: file.role === "primary" ? "PRIMARY" : "IR",
        storageKey: movedKey,
        contentHash: sha256(file.bytes),
        size: file.bytes.length,
        mime: "application/octet-stream",
        ext: file.ext,
      },
    });
    fileRows.push(row);
  }

  for (const tagId of tagIds) {
    await prisma.presetTag.create({ data: { presetId, tagId } });
  }

  const tagRows = tagIds.length ? await prisma.tag.findMany({ where: { id: { in: tagIds } } }) : [];

  await audit({
    actorId: user.id,
    action: "preset.create",
    target: presetId,
    meta: { pedalSlug: pedal.slug, status, kind: body.kind },
    ip: clientIp(req),
  });

  res.status(201).json({
    preset: serializePreset(
      preset as unknown as Record<string, unknown>,
      pedal,
      { id: user.id, displayName: user.displayName, verified: user.verified },
      tagRows.map((t) => ({ slug: t.slug, label: t.label })),
      fileRows,
    ),
  });
});

type PresetCounts = {
  up: number;
  down: number;
  score: number;
  comments: number;
  downloads: number;
  views: number;
};

function aggregateCounts(
  presetId: string,
  votes: { presetId: string; value: number }[],
  commentsByPreset: Map<string, number>,
  preset: Record<string, unknown>,
): PresetCounts {
  let up = 0;
  let down = 0;
  for (const vote of votes) {
    if (String(vote.presetId) !== presetId) continue;
    if (vote.value > 0) up += 1;
    else if (vote.value < 0) down += 1;
  }
  return {
    up,
    down,
    score: up - down,
    comments: commentsByPreset.get(presetId) ?? 0,
    downloads: Number(preset.downloadCount ?? 0),
    views: Number(preset.viewCount ?? 0),
  };
}

function downloadFilename(preset: Record<string, unknown>, file: Record<string, unknown>): string {
  const base =
    String(preset.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "preset";
  const ext = file.ext ? `.${String(file.ext).replace(/^\./, "")}` : "";
  return `${base}${ext}`;
}

async function recordDownload(preset: Record<string, unknown>, req: Request): Promise<void> {
  await prisma.preset.update({
    where: { id: String(preset.id) },
    data: { downloadCount: { increment: 1 } },
  });
  const clientKey = req.auth
    ? `user:${req.auth.user.id}`
    : `anon:${createHash("sha256")
        .update(`${clientIp(req)}|${req.headers["user-agent"] ?? ""}`)
        .digest("hex")
        .slice(0, 24)}`;
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  try {
    await prisma.downloadEvent.create({
      data: { id: newId(), presetId: String(preset.id), clientKey, day },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err; // already counted today
  }
}

const listQuerySchema = z.object({
  pedal: z.string().trim().min(1).optional(),
  section: z.enum(["general", "songs"]).optional(),
  tag: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(["hot", "new", "top", "downloads", "comments"]).default("hot"),
  usesIr: z.enum(["true", "false"]).optional(),
  verified: z.enum(["true", "false"]).optional(),
  cursor: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type ListSort = NonNullable<z.infer<typeof listQuerySchema>["sort"]>;

function ts(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(new Date(String(value)));
}

function sortPresets(
  rows: Record<string, unknown>[],
  sort: ListSort,
  scores: Map<string, number>,
  comments: Map<string, number>,
): Record<string, unknown>[] {
  const compareFn: Record<
    ListSort,
    (a: Record<string, unknown>, b: Record<string, unknown>) => number
  > = {
    hot: (a, b) =>
      hotScore(scores.get(String(b.id)) ?? 0, b.createdAt) -
        hotScore(scores.get(String(a.id)) ?? 0, a.createdAt) || ts(b.createdAt) - ts(a.createdAt),
    new: (a, b) =>
      ts(b.createdAt) - ts(a.createdAt) ||
      hotScore(scores.get(String(a.id)) ?? 0, a.createdAt) -
        hotScore(scores.get(String(b.id)) ?? 0, b.createdAt),
    top: (a, b) =>
      (scores.get(String(b.id)) ?? 0) - (scores.get(String(a.id)) ?? 0) ||
      ts(b.createdAt) - ts(a.createdAt),
    downloads: (a, b) =>
      Number(b.downloadCount ?? 0) - Number(a.downloadCount ?? 0) ||
      ts(b.createdAt) - ts(a.createdAt),
    comments: (a, b) =>
      (comments.get(String(b.id)) ?? 0) - (comments.get(String(a.id)) ?? 0) ||
      ts(b.createdAt) - ts(a.createdAt),
  };
  return [...rows].sort(compareFn[sort]);
}

presetsRouter.get("/", async (req, res) => {
  const query = await listQuerySchema.parseAsync(req.query);

  const where: Record<string, unknown> = { status: "PUBLISHED" };
  if (query.pedal) {
    const pedal = await prisma.pedal.findUnique({ where: { slug: query.pedal } });
    if (!pedal) throw new ApiError(404, "PEDAL_NOT_FOUND", "No such pedal in the catalog");
    where.pedalId = pedal.id;
  }
  if (query.section) where.section = query.section.toUpperCase();
  if (query.usesIr) where.usesThirdPartyIr = query.usesIr === "true";

  const candidates = (await prisma.preset.findMany({ where })) as unknown as Record<
    string,
    unknown
  >[];
  if (candidates.length === 0) {
    res.json({ presets: [], nextCursor: null, total: 0 });
    return;
  }

  const candidateIds = candidates.map((p) => String(p.id));
  const userIds = [...new Set(candidates.map((p) => String(p.userId)))];
  const pedalIds = [...new Set(candidates.map((p) => String(p.pedalId)))];

  const [users, pedalRows, presetTags, tagRows, fileRows, voteRows, commentRows] =
    await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } } }),
      prisma.pedal.findMany({ where: { id: { in: pedalIds } } }),
      prisma.presetTag.findMany({ where: { presetId: { in: candidateIds } } }),
      prisma.tag.findMany({}),
      prisma.presetFile.findMany({ where: { presetId: { in: candidateIds } } }),
      prisma.vote.findMany({ where: { presetId: { in: candidateIds } } }),
      prisma.comment.findMany({ where: { presetId: { in: candidateIds }, deletedAt: null } }),
    ]);

  const userById = new Map(users.map((u) => [String(u.id), u]));
  const pedalById = new Map(pedalRows.map((p) => [String(p.id), p]));
  const tagById = new Map(tagRows.map((t) => [String(t.id), t]));
  const tagsByPreset = new Map<string, { slug: string; label: string }[]>();
  for (const pt of presetTags as { presetId: string; tagId: string }[]) {
    const tag = tagById.get(String(pt.tagId));
    if (!tag) continue;
    const list = tagsByPreset.get(String(pt.presetId)) ?? [];
    list.push({ slug: String(tag.slug), label: String(tag.label) });
    tagsByPreset.set(String(pt.presetId), list);
  }
  const filesByPreset = new Map<string, Record<string, unknown>[]>();
  for (const file of fileRows as Record<string, unknown>[]) {
    const list = filesByPreset.get(String(file.presetId)) ?? [];
    list.push(file);
    filesByPreset.set(String(file.presetId), list);
  }

  const tagFilter = query.tag?.toLowerCase();
  const q = query.q?.toLowerCase();

  const filtered = candidates.filter((p) => {
    if (tagFilter) {
      const tags = tagsByPreset.get(String(p.id)) ?? [];
      if (!tags.some((t) => t.slug === tagFilter)) return false;
    }
    if (query.verified === "true" || query.verified === "false") {
      const wanted = query.verified === "true";
      const verified = Boolean(
        (userById.get(String(p.userId)) as { verified?: boolean } | undefined)?.verified,
      );
      if (verified !== wanted) return false;
    }
    if (q) {
      const user = userById.get(String(p.userId)) as { displayName?: string } | undefined;
      const tags = tagsByPreset.get(String(p.id)) ?? [];
      const haystack = [
        String(p.title ?? ""),
        String(p.descriptionMd ?? ""),
        String(p.songTitle ?? ""),
        String(p.artist ?? ""),
        user?.displayName ?? "",
        ...tags.flatMap((t) => [t.slug, t.label]),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const commentCounts = new Map<string, number>();
  for (const c of commentRows as { presetId: string }[]) {
    commentCounts.set(String(c.presetId), (commentCounts.get(String(c.presetId)) ?? 0) + 1);
  }

  const scores = new Map<string, number>();
  for (const p of filtered) {
    const voteRowsForPreset = (voteRows as { presetId: string; value: number }[]).filter(
      (v) => String(v.presetId) === String(p.id),
    );
    const counts = aggregateCounts(String(p.id), voteRowsForPreset, commentCounts, p);
    scores.set(String(p.id), counts.score);
  }

  const sorted = sortPresets(filtered, query.sort, scores, commentCounts);
  const start = query.cursor
    ? Math.max(0, sorted.findIndex((p) => String(p.id) === query.cursor) + 1)
    : 0;
  if (query.cursor && start === 0 && !sorted.some((p) => String(p.id) === query.cursor)) {
    throw new ApiError(400, "INVALID_CURSOR", "That page cursor is no longer valid");
  }
  const page = sorted.slice(start, start + query.limit);
  const end = start + page.length;

  res.json({
    presets: page.map((p) => ({
      ...serializePreset(
        p,
        pedalById.get(String(p.pedalId)) as unknown as PedalRow,
        {
          id: String(p.userId),
          displayName: String(
            (userById.get(String(p.userId)) as { displayName?: string })?.displayName ?? "",
          ),
          verified: Boolean((userById.get(String(p.userId)) as { verified?: boolean })?.verified),
        },
        tagsByPreset.get(String(p.id)) ?? [],
        filesByPreset.get(String(p.id)) ?? [],
      ),
      counts: aggregateCounts(
        String(p.id),
        voteRows as { presetId: string; value: number }[],
        commentCounts,
        p,
      ),
    })),
    nextCursor: end < sorted.length ? String(page[page.length - 1]?.id ?? "") : null,
    total: sorted.length,
  });
});

presetsRouter.get("/:id", async (req, res) => {
  const preset = await prisma.preset.findUnique({ where: { id: String(req.params.id) } });
  if (!preset) throw new ApiError(404, "PRESET_NOT_FOUND", "No such preset");

  const isOwner = req.auth?.user.id === preset.userId;
  if (String(preset.status) !== "PUBLISHED" && !isOwner) {
    throw new ApiError(404, "PRESET_NOT_FOUND", "No such preset");
  }

  await prisma.preset.update({
    where: { id: preset.id },
    data: { viewCount: { increment: 1 } },
  });
  preset.viewCount = Number(preset.viewCount ?? 0) + 1;

  const [pedal, user, presetTags, tagRows, fileRows, voteRows, commentCount, gear] =
    await Promise.all([
      prisma.pedal.findUnique({ where: { id: String(preset.pedalId) } }),
      prisma.user.findUnique({ where: { id: String(preset.userId) } }),
      prisma.presetTag.findMany({ where: { presetId: preset.id } }),
      prisma.tag.findMany({}),
      prisma.presetFile.findMany({ where: { presetId: preset.id } }),
      prisma.vote.findMany({ where: { presetId: preset.id } }),
      prisma.comment.count({ where: { presetId: preset.id, deletedAt: null } }),
      req.auth
        ? prisma.userGear.findFirst({
            where: { userId: req.auth.user.id, pedalId: String(preset.pedalId) },
          })
        : Promise.resolve(null),
    ]);

  const tagById = new Map(tagRows.map((t) => [String(t.id), t]));
  const tags = (presetTags as { tagId: string }[])
    .map((pt) => tagById.get(String(pt.tagId)))
    .filter((t) => t !== undefined)
    .map((t) => ({ slug: String(t!.slug), label: String(t!.label) }));

  const counts = aggregateCounts(
    preset.id,
    voteRows as { presetId: string; value: number }[],
    new Map([[preset.id, commentCount]]),
    preset as unknown as Record<string, unknown>,
  );

  const userVote = req.auth
    ? ((voteRows as { userId: string; value: number }[]).find(
        (v) => String(v.userId) === req.auth!.user.id,
      )?.value ?? 0)
    : 0;

  let firmwareWarning: string | null = null;
  if (gear?.firmwareVersion && preset.firmwareVersion) {
    const gearFw = String(gear.firmwareVersion).trim().toLowerCase();
    const needsFw = String(preset.firmwareVersion).trim().toLowerCase();
    if (gearFw !== needsFw) {
      firmwareWarning = `This preset targets firmware ${preset.firmwareVersion} but your ${String(pedal?.model ?? "pedal")} is running ${gear.firmwareVersion}.`;
    }
  }

  res.json({
    preset: {
      ...serializePreset(
        preset as unknown as Record<string, unknown>,
        pedal as unknown as PedalRow,
        {
          id: String(preset.userId),
          displayName: String((user as { displayName?: string })?.displayName ?? ""),
          verified: Boolean((user as { verified?: boolean })?.verified),
        },
        tags,
        fileRows as Record<string, unknown>[],
      ),
      pedal: {
        slug: String(pedal?.slug ?? ""),
        brand: String(pedal?.brand ?? ""),
        model: String(pedal?.model ?? ""),
        importInstructionsMd: String(pedal?.importInstructionsMd ?? ""),
      },
      counts,
      userVote,
      firmwareWarning,
      mine: isOwner,
    },
  });
});

const voteSchema = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

presetsRouter.put("/:id/vote", async (req, res) => {
  const { user } = requireAuthed(req);
  limit(`vote:${user.id}`, 60, "Voting is limited to 60 per hour");
  const { value } = await voteSchema.parseAsync(req.body);

  const preset = await prisma.preset.findUnique({ where: { id: String(req.params.id) } });
  if (!preset || String(preset.status) !== "PUBLISHED") {
    throw new ApiError(404, "PRESET_NOT_FOUND", "No such preset");
  }
  if (preset.userId === user.id) {
    throw new ApiError(403, "VOTE_OWN_PRESET", "You cannot vote on your own preset");
  }

  const existing = await prisma.vote.findFirst({
    where: { presetId: preset.id, userId: user.id },
  });

  if (value === 0) {
    if (existing) {
      await prisma.vote.deleteMany({ where: { presetId: preset.id, userId: user.id } });
    }
  } else if (existing) {
    if (Number(existing.value) !== value) {
      await prisma.vote.updateMany({
        where: { presetId: preset.id, userId: user.id },
        data: { value },
      });
    }
  } else {
    await prisma.vote.create({
      data: { presetId: preset.id, userId: user.id, value },
    });
  }

  const votes = (await prisma.vote.findMany({ where: { presetId: preset.id } })) as unknown as {
    userId: string;
    value: number;
  }[];
  let up = 0;
  let down = 0;
  for (const vote of votes) {
    if (vote.value > 0) up += 1;
    else if (vote.value < 0) down += 1;
  }

  await refreshPresetHotRank(preset.id);
  await audit({
    actorId: user.id,
    action: "vote.set",
    target: preset.id,
    meta: { value },
    ip: clientIp(req),
  });

  res.json({ counts: { up, down, score: up - down }, userVote: value });
});

const commentCreateSchema = z.object({
  bodyMd: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  parentId: z.string().trim().min(1).max(80).optional(),
});

const commentsQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

async function loadCommentAuthors(
  rows: { userId: string }[],
): Promise<Map<string, { id: string; displayName: string; verified: boolean }>> {
  const ids = [...new Set(rows.map((r) => String(r.userId)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } } });
  return new Map(
    users.map((u) => [
      String(u.id),
      { id: String(u.id), displayName: String(u.displayName), verified: Boolean(u.verified) },
    ]),
  );
}

presetsRouter.get("/:id/comments", async (req, res) => {
  const query = await commentsQuerySchema.parseAsync(req.query);
  const preset = await prisma.preset.findUnique({ where: { id: String(req.params.id) } });
  if (!preset || String(preset.status) !== "PUBLISHED") {
    throw new ApiError(404, "PRESET_NOT_FOUND", "No such preset");
  }

  const all = (await prisma.comment.findMany({
    where: { presetId: preset.id, parentId: null },
    orderBy: { createdAt: "desc" },
  })) as unknown as CommentRow[];

  let start = 0;
  if (query.cursor) {
    const index = all.findIndex((c) => String(c.id) === query.cursor);
    if (index === -1)
      throw new ApiError(400, "INVALID_CURSOR", "That page cursor is no longer valid");
    start = index + 1;
  }
  const page = all.slice(start, start + query.limit);
  const topIds = page.map((c) => String(c.id));

  const replyRows = topIds.length
    ? ((await prisma.comment.findMany({
        where: { presetId: preset.id, parentId: { in: topIds } },
        orderBy: { createdAt: "asc" },
      })) as unknown as CommentRow[])
    : [];

  const authors = await loadCommentAuthors([...page, ...replyRows]);
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const reply of replyRows) {
    const list = repliesByParent.get(String(reply.parentId)) ?? [];
    list.push(reply);
    repliesByParent.set(String(reply.parentId), list);
  }

  const comments = page.map((row) =>
    serializeComment(
      row,
      authors.get(String(row.userId)) ?? null,
      (repliesByParent.get(String(row.id)) ?? []).map((reply) =>
        serializeComment(reply, authors.get(String(reply.userId)) ?? null),
      ),
    ),
  );

  res.json({
    comments,
    nextCursor: start + page.length < all.length ? String(page[page.length - 1]?.id ?? "") : null,
    total: all.length,
  });
});

presetsRouter.post("/:id/comments", async (req, res) => {
  const { user } = requireAuthed(req);
  limit(`comment:${user.id}`, 20, "Commenting is limited to 20 per hour");
  const body = await commentCreateSchema.parseAsync(req.body);

  const preset = await prisma.preset.findUnique({ where: { id: String(req.params.id) } });
  if (!preset || String(preset.status) !== "PUBLISHED") {
    throw new ApiError(404, "PRESET_NOT_FOUND", "No such preset");
  }

  if (Date.now() - user.createdAt.getTime() < COMMENT_MIN_ACCOUNT_AGE_MS) {
    throw new ApiError(
      403,
      "ACCOUNT_TOO_NEW",
      "New accounts must wait a few minutes before commenting",
    );
  }

  let parentId: string | null = null;
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: body.parentId } });
    if (
      !parent ||
      String(parent.presetId) !== String(preset.id) ||
      parent.parentId !== null ||
      parent.deletedAt
    ) {
      throw new ApiError(
        400,
        "COMMENT_PARENT_INVALID",
        "You can only reply to a top-level comment on this preset",
      );
    }
    parentId = String(parent.id);
  }

  const rendered = renderMarkdown(body.bodyMd);
  if (rendered.links > MAX_COMMENT_LINKS) {
    throw new ApiError(
      400,
      "COMMENT_TOO_MANY_LINKS",
      `Comments may contain at most ${MAX_COMMENT_LINKS} links`,
    );
  }

  const comment = (await prisma.comment.create({
    data: {
      id: newId(),
      presetId: preset.id,
      userId: user.id,
      parentId,
      bodyMd: body.bodyMd,
      bodyHtml: rendered.html,
      bodyHtmlVersion: MARKDOWN_VERSION,
    },
  })) as unknown as CommentRow;

  await audit({
    actorId: user.id,
    action: "comment.create",
    target: String(comment.id),
    meta: { presetId: String(preset.id), parentId },
    ip: clientIp(req),
  });

  res.status(201).json({
    comment: serializeComment(comment, {
      id: user.id,
      displayName: user.displayName,
      verified: user.verified,
    }),
  });
});

presetsRouter.get("/:id/download", async (req, res) => {
  const preset = await prisma.preset.findUnique({ where: { id: String(req.params.id) } });
  if (!preset || String(preset.status) !== "PUBLISHED") {
    throw new ApiError(404, "PRESET_NOT_FOUND", "No such preset");
  }

  if (req.auth) {
    limit(`download:${req.auth.user.id}`, 100, "Downloads are limited to 100 per hour");
  } else {
    limit(
      `download:anon:${clientIp(req)}`,
      30,
      "Downloads are limited to 30 per hour — sign in for more",
    );
  }

  await recordDownload(preset as unknown as Record<string, unknown>, req);
  res.set("Cache-Control", "no-store");

  if (String(preset.kind).toUpperCase() === "CLOUD_LINK" && preset.cloudUrl) {
    res.redirect(302, String(preset.cloudUrl));
    return;
  }

  const file = await prisma.presetFile.findFirst({
    where: { presetId: preset.id, role: "PRIMARY" },
  });
  if (!file) {
    throw new ApiError(404, "PRESET_FILE_NOT_FOUND", "This preset has no downloadable file");
  }

  const { url } = await getStorage().presignGet(String(file.storageKey), {
    filename: downloadFilename(
      preset as unknown as Record<string, unknown>,
      file as unknown as Record<string, unknown>,
    ),
  });
  res.redirect(302, url);
});
