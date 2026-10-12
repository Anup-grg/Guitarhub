import { Router } from "express";
import { z } from "zod";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/id.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import { sendVerificationEmail } from "../lib/mail-tokens.js";
import {
  clearAuthCookies,
  revokeAllSessions,
  revokeSession,
} from "../lib/session.js";
import { bioSchema, displayNameSchema, emailSchema, linksSchema } from "../lib/schemas.js";
import { ensureStepUp, requireAuthed, requireUser } from "../middleware/auth.js";
import { selfUser } from "../lib/users.js";

export const meRouter = Router();
meRouter.use(requireUser);

const gearSchema = z.array(
  z.object({
    pedalId: z.string().min(1),
    firmwareVersion: z.string().trim().max(40).optional().nullable(),
  }),
);

const patchSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: bioSchema,
  avatarUrl: z
    .string()
    .trim()
    .max(500)
    .url("Avatar must be a valid URL")
    .refine((u) => /^https?:\/\//i.test(u), "Avatar must be an http(s) URL")
    .optional()
    .nullable(),
  links: linksSchema,
  gear: gearSchema.optional(),
  email: emailSchema.optional(),
});

async function loadGear(userId: string) {
  const rows = await prisma.userGear.findMany({
    where: { userId },
    include: { pedal: { select: { id: true, brand: true, model: true, slug: true } } },
    orderBy: { pedal: { model: "asc" } },
  });
  return rows.map((row) => ({
    pedalId: row.pedalId,
    firmwareVersion: row.firmwareVersion,
    pedal: row.pedal,
  }));
}

meRouter.get("/", async (req, res) => {
  const { user } = requireAuthed(req);
  res.json({ user: selfUser(user), gear: await loadGear(user.id) });
});

meRouter.patch("/", async (req, res) => {
  const { user } = requireAuthed(req);
  const body = await patchSchema.parseAsync(req.body);

  const data: Prisma.UserUpdateInput = {};
  if (body.displayName !== undefined) data.displayName = body.displayName;
  if (body.bio !== undefined) data.bio = body.bio === "" ? null : body.bio;
  if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl === "" ? null : body.avatarUrl;
  if (body.links !== undefined) data.links = body.links;

  let emailChangePending = false;
  if (body.email !== undefined && body.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing && existing.id !== user.id) {
      throw new ApiError(409, "EMAIL_TAKEN", "That email is already registered");
    }
    await ensureStepUp(req);
    data.pendingEmail = body.email;
    emailChangePending = true;
  }

  if (body.gear !== undefined) {
    const pedalIds = [...new Set(body.gear.map((g) => g.pedalId))];
    const pedals = await prisma.pedal.findMany({
      where: { id: { in: pedalIds }, enabled: true },
      select: { id: true },
    });
    if (pedals.length !== pedalIds.length) {
      throw new ApiError(400, "UNKNOWN_PEDAL", "One of the pedals in your gear list is unknown");
    }
    await prisma.$transaction([
      prisma.userGear.deleteMany({ where: { userId: user.id } }),
      prisma.userGear.createMany({
        data: body.gear.map((g) => ({
          id: newId(),
          userId: user.id,
          pedalId: g.pedalId,
          firmwareVersion: g.firmwareVersion ?? null,
        })),
      }),
    ]);
  }

  const updated =
    Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id: user.id }, data })
      : user;

  if (emailChangePending) {
    await sendVerificationEmail({ ...updated, pendingEmail: body.email });
    await audit({
      actorId: user.id,
      action: "auth.email_change_requested",
      target: `user:${user.id}`,
      ip: clientIp(req),
    });
  }
  await audit({
    actorId: user.id,
    action: "profile.update",
    target: `user:${user.id}`,
    meta: { fields: Object.keys(data) },
    ip: clientIp(req),
  });

  res.json({
    user: selfUser((updated ?? user) as User),
    gear: await loadGear(user.id),
    ...(emailChangePending ? { emailChangePending: true } : {}),
  });
});

const deleteSchema = z.object({
  confirm: z.literal("DELETE", {
    errorMap: () => ({ message: 'Type "DELETE" to confirm' }),
  }),
  presetAction: z.enum(["anonymize", "remove"], {
    errorMap: () => ({ message: 'Choose "anonymize" or "remove"' }),
  }),
  password: z.string().max(200).optional(),
  totp: z.string().trim().max(10).optional(),
});

meRouter.delete("/", async (req, res) => {
  const { user } = requireAuthed(req);
  const body = await deleteSchema.parseAsync(req.body);
  await ensureStepUp(req);

  if (body.presetAction === "remove") {
    await prisma.preset.deleteMany({ where: { userId: user.id } });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        email: `deleted-${user.id.toLowerCase()}@deleted.invalid`,
        pendingEmail: null,
        displayName: "Deleted user",
        bio: null,
        avatarUrl: null,
        links: Prisma.DbNull,
        passwordHash: null,
        totpEnabled: false,
        totpSecret: null,
        totpPendingSecret: null,
        emailVerifiedAt: null,
        deletedAt: now,
      },
    }),
    prisma.authIdentity.deleteMany({ where: { userId: user.id } }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.emailToken.deleteMany({ where: { userId: user.id } }),
    prisma.userGear.deleteMany({ where: { userId: user.id } }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  clearAuthCookies(res);
  await audit({
    actorId: user.id,
    action: "auth.account_deleted",
    target: `user:${user.id}`,
    meta: { presetAction: body.presetAction },
    ip: clientIp(req),
  });
  res.json({ ok: true });
});

meRouter.get("/sessions", async (req, res) => {
  const { user, session } = requireAuthed(req);
  const rows = await prisma.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    sessions: rows.map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      current: row.id === session.id,
    })),
  });
});

meRouter.delete("/sessions/:id", async (req, res) => {
  const { user, session } = requireAuthed(req);
  const target = await prisma.session.findUnique({ where: { id: req.params.id! } });
  if (!target || target.userId !== user.id || target.revokedAt) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "That session does not exist");
  }
  await revokeSession(target.id);
  await audit({
    actorId: user.id,
    action: "auth.session_revoked",
    target: `session:${target.id}`,
    ip: clientIp(req),
  });
  if (target.id === session.id) clearAuthCookies(res);
  res.json({ ok: true });
});

meRouter.delete("/sessions", async (req, res) => {
  const { user } = requireAuthed(req);
  const count = await revokeAllSessions(user.id);
  clearAuthCookies(res);
  await audit({
    actorId: user.id,
    action: "auth.sessions_revoked_all",
    target: `user:${user.id}`,
    meta: { count },
    ip: clientIp(req),
  });
  res.json({ ok: true, revoked: count });
});

const stepUpSchema = z.object({
  password: z.string().max(200).optional(),
  totp: z.string().trim().max(10).optional(),
});

meRouter.post("/step-up", async (req, res) => {
  requireAuthed(req);
  await stepUpSchema.parseAsync(req.body);
  await ensureStepUp(req);
  res.json({ ok: true });
});

meRouter.get("/identities", async (req, res) => {
  const { user } = requireAuthed(req);
  const rows = await prisma.authIdentity.findMany({ where: { userId: user.id } });
  res.json({
    identities: rows.map((row) => ({
      provider: row.provider,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

meRouter.delete("/identities/:provider", async (req, res) => {
  const { user } = requireAuthed(req);
  const provider = req.params.provider!;
  const owned = await prisma.authIdentity.findFirst({ where: { userId: user.id, provider } });
  if (!owned) throw new ApiError(404, "IDENTITY_NOT_FOUND", "That sign-in method is not linked");

  const others = await prisma.authIdentity.count({ where: { userId: user.id } });
  if (!user.passwordHash && others <= 1) {
    throw new ApiError(
      400,
      "LAST_AUTH_METHOD",
      "Set a password first — this is your only way to sign in",
    );
  }

  await prisma.authIdentity.delete({ where: { id: owned.id } });
  await audit({
    actorId: user.id,
    action: "auth.identity_unlinked",
    target: `provider:${provider}`,
    ip: clientIp(req),
  });
  res.json({ ok: true });
});
