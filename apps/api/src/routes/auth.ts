import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/id.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import { burnPasswordTime, hashPassword, verifyPassword } from "../lib/password.js";
import { checkRate, rateLimited, type RateLimitRule } from "../lib/rate-limit.js";
import { consumeToken, sendPasswordResetEmail, sendVerificationEmail } from "../lib/mail-tokens.js";
import {
  createSession,
  clearAuthCookies,
  refreshCookieName,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  setSessionCookies,
  stampStepUp,
  ABSOLUTE_MS,
} from "../lib/session.js";
import { hashToken } from "../lib/tokens.js";
import {
  createTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  totpUri,
  verifyTotp,
} from "../lib/totp.js";
import { displayNameSchema, emailSchema, passwordSchema, tosSchema } from "../lib/schemas.js";
import { ensureStepUp, requireAuthed, requireUser } from "../middleware/auth.js";
import { isHardBanned, selfUser } from "../lib/users.js";

export const authRouter = Router();

const LOGIN_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 10 };
// Per-source cap that backs up the per-account limit — blocks credential stuffing across many accounts.
const LOGIN_IP_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 50 };
const REGISTER_RULE: RateLimitRule = { windowMs: 60 * 60 * 1000, max: 5 };
const RESET_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 5 };
const TOKEN_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 10 };
const TWO_FACTOR_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 10 };

function limited(rule: RateLimitRule, key: string): void {
  const result = checkRate(key, rule);
  if (!result.allowed) rateLimited(result);
}

const registerSchema = tosSchema.extend({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  rememberMe: z.boolean().optional(),
});

authRouter.post("/register", async (req, res) => {
  limited(REGISTER_RULE, `register:${clientIp(req)}`);
  const input = await registerSchema.parseAsync(req.body);

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError(409, "EMAIL_TAKEN", "That email is already registered");

  const now = new Date();
  let user;
  try {
    user = await prisma.user.create({
      data: {
        id: newId(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        tosVersion: input.tosVersion,
        tosAcceptedAt: now,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new ApiError(409, "EMAIL_TAKEN", "That email is already registered");
    }
    throw err;
  }

  await sendVerificationEmail(user);
  const { session, refreshToken } = await createSession({
    userId: user.id,
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    stepUp: true,
    deviceName: deviceLabel(req.get("user-agent")),
  });
  setSessionCookies(res, session, refreshToken, input.rememberMe === true);
  await audit({
    actorId: user.id,
    action: "auth.register",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });

  res.status(201).json({ user: selfUser(user) });
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  totp: z.string().trim().max(10).optional(),
  recoveryCode: z.string().trim().max(32).optional(),
  rememberMe: z.boolean().optional(),
});

authRouter.post("/login", async (req, res) => {
  const body = await loginSchema.parseAsync(req.body);
  limited(LOGIN_IP_RULE, `login-ip:${clientIp(req)}`);
  limited(LOGIN_RULE, `login:${clientIp(req)}|${body.email}`);

  const user = await prisma.user.findUnique({ where: { email: body.email } });

  if (!user || user.deletedAt || !user.passwordHash) {
    await burnPasswordTime(body.password);
    await audit({
      actorId: user?.id ?? null,
      action: "auth.login_failed",
      target: `user:${user?.id ?? "unknown"}`,
      meta: { reason: "unknown_account" },
      ip: clientIp(req),
    });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  const ok = await verifyPassword(user.passwordHash, body.password);
  if (!ok) {
    await audit({
      actorId: user.id,
      action: "auth.login_failed",
      target: `user:${user.id}`,
      meta: { reason: "bad_password" },
      ip: clientIp(req),
    });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  if (isHardBanned(user)) {
    throw new ApiError(403, "ACCOUNT_BANNED", "This account is suspended");
  }

  if (user.totpEnabled) {
    if (!body.totp && !body.recoveryCode) {
      throw new ApiError(403, "TWO_FACTOR_REQUIRED", "Enter your two-factor code");
    }
    let valid = false;
    if (body.recoveryCode) {
      valid = await consumeRecoveryCode(user.id, body.recoveryCode);
    } else if (user.totpSecret && body.totp) {
      valid = await verifyTotp(user.totpSecret, body.totp);
    }
    if (!valid) {
      await audit({
        actorId: user.id,
        action: "auth.login_failed",
        target: `user:${user.id}`,
        meta: { reason: "bad_2fa" },
        ip: clientIp(req),
      });
      throw new ApiError(401, "INVALID_2FA_CODE", "Two-factor code is incorrect");
    }
  }

  const { session, refreshToken } = await createSession({
    userId: user.id,
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    stepUp: true,
    deviceName: deviceLabel(req.get("user-agent")),
  });
  setSessionCookies(res, session, refreshToken, body.rememberMe === true);
  await audit({
    actorId: user.id,
    action: "auth.login",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });

  res.json({ user: selfUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  if (req.auth) {
    await revokeSession(req.auth.session.id);
    await audit({
      actorId: req.auth.user.id,
      action: "auth.logout",
      target: `user:${req.auth.user.id}`,
      ip: clientIp(req),
    });
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.post("/refresh", async (req, res) => {
  const invalid: (code: string, message: string) => never = (code, message) => {
    clearAuthCookies(res);
    throw new ApiError(401, code, message);
  };

  const raw = req.cookies?.[refreshCookieName()] as string | undefined;
  if (!raw) invalid("SESSION_EXPIRED", "Sign in again");

  const tokenHash = hashToken(raw!);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });

  if (!session) {
    const reused = await prisma.session.findFirst({
      where: { usedHashes: { has: tokenHash }, revokedAt: null },
    });
    if (reused) {
      await revokeSession(reused.id);
      await audit({
        actorId: reused.userId,
        action: "auth.session_reuse_detected",
        target: `session:${reused.id}`,
        meta: { family: reused.refreshFamily },
        ip: clientIp(req),
      });
      invalid("SESSION_REUSE_DETECTED", "Session revoked for security reasons");
    }
    invalid("SESSION_EXPIRED", "Sign in again");
  }

  if (session!.revokedAt) invalid("SESSION_EXPIRED", "Sign in again");
  if (
    session!.expiresAt.getTime() <= Date.now() ||
    session!.createdAt.getTime() + ABSOLUTE_MS <= Date.now()
  ) {
    await revokeSession(session!.id);
    invalid("SESSION_EXPIRED", "Sign in again");
  }

  const user = await prisma.user.findUnique({ where: { id: session!.userId } });
  if (!user || user.deletedAt) invalid("SESSION_EXPIRED", "Sign in again");
  if (isHardBanned(user!)) invalid("ACCOUNT_BANNED", "This account is suspended");

  const nextToken = await rotateSession(session!);
  setSessionCookies(res, session!, nextToken, true);
  res.json({ user: selfUser(user!) });
});

const forgotSchema = z.object({ email: emailSchema });

authRouter.post("/password/forgot", async (req, res) => {
  const body = await forgotSchema.parseAsync(req.body);
  limited(RESET_RULE, `forgot:${clientIp(req)}|${body.email}`);

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && !user.deletedAt) {
    await sendPasswordResetEmail(user);
    await audit({
      actorId: user.id,
      action: "auth.password_reset_requested",
      target: `user:${user.id}`,
      ip: clientIp(req),
    });
  }
  // Uniform response — never reveals whether the account exists (SRS §6.1).
  res.status(202).json({ status: "accepted" });
});

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

authRouter.post("/password/reset", async (req, res) => {
  limited(TOKEN_RULE, `reset:${clientIp(req)}`);
  const body = await resetSchema.parseAsync(req.body);

  const consumed = await consumeToken(body.token, "PASSWORD_RESET");
  if (!consumed) {
    throw new ApiError(400, "INVALID_OR_EXPIRED_TOKEN", "This reset link is invalid or expired");
  }

  const user = await prisma.user.findUnique({ where: { id: consumed.userId } });
  if (!user || user.deletedAt) {
    throw new ApiError(400, "INVALID_OR_EXPIRED_TOKEN", "This reset link is invalid or expired");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.password) },
  });
  await revokeAllSessions(user.id);
  await audit({
    actorId: user.id,
    action: "auth.password_reset",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });

  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.post("/password/change", requireUser, async (req, res) => {
  const { user, session } = requireAuthed(req);
  limited(TOKEN_RULE, `pwchange:${user.id}`);
  const body = await z
    .object({
      currentPassword: z.string().min(1).max(200),
      newPassword: passwordSchema,
    })
    .parseAsync(req.body);

  const ok = user.passwordHash && (await verifyPassword(user.passwordHash, body.currentPassword));
  if (!ok) {
    await audit({
      actorId: user.id,
      action: "auth.password_change_failed",
      target: `user:${user.id}`,
      ip: clientIp(req),
    });
    throw new ApiError(403, "INVALID_CREDENTIALS", "Current password is incorrect");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });
  await revokeAllSessions(user.id, session.id);
  await stampStepUp(session.id);
  await audit({
    actorId: user.id,
    action: "auth.password_changed",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });
  res.json({ ok: true });
});

authRouter.post("/verify-email", async (req, res) => {
  limited(TOKEN_RULE, `verify:${clientIp(req)}`);
  const body = await z.object({ token: z.string().min(10).max(200) }).parseAsync(req.body);

  const consumed = await consumeToken(body.token, "EMAIL_VERIFY");
  if (!consumed) {
    throw new ApiError(
      400,
      "INVALID_OR_EXPIRED_TOKEN",
      "This verification link is invalid or expired",
    );
  }

  const user = await prisma.user.findUnique({ where: { id: consumed.userId } });
  if (!user)
    throw new ApiError(
      400,
      "INVALID_OR_EXPIRED_TOKEN",
      "This verification link is invalid or expired",
    );

  const now = new Date();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: user.pendingEmail
      ? { email: user.pendingEmail, pendingEmail: null, emailVerifiedAt: now }
      : { emailVerifiedAt: now },
  });
  await audit({
    actorId: user.id,
    action: "auth.email_verified",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });

  res.json({ ok: true, user: selfUser(updated) });
});

authRouter.post("/verify-email/resend", requireUser, async (req, res) => {
  const { user } = requireAuthed(req);
  limited({ windowMs: 15 * 60 * 1000, max: 3 }, `resend:${user.id}`);

  if (user.emailVerifiedAt && !user.pendingEmail) {
    throw new ApiError(400, "ALREADY_VERIFIED", "Your email is already confirmed");
  }
  await sendVerificationEmail(user);
  res.status(202).json({ status: "accepted" });
});

authRouter.post("/2fa/setup", requireUser, async (req, res) => {
  const { user } = requireAuthed(req);
  limited(TWO_FACTOR_RULE, `2fa-setup:${user.id}`);

  if (user.totpEnabled) {
    throw new ApiError(
      409,
      "TWO_FACTOR_ALREADY_ENABLED",
      "Two-factor authentication is already on",
    );
  }
  const secret = createTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpPendingSecret: secret },
  });
  res.json({ secret, uri: totpUri(secret, user.email) });
});

const twoFactorVerifySchema = z.object({ code: z.string().trim().min(6).max(8) });

authRouter.post("/2fa/verify", requireUser, async (req, res) => {
  const { user, session } = requireAuthed(req);
  limited(TWO_FACTOR_RULE, `2fa-verify:${user.id}`);
  const body = await twoFactorVerifySchema.parseAsync(req.body);

  if (!user.totpPendingSecret) {
    throw new ApiError(400, "TWO_FACTOR_NOT_PENDING", "Start setup first");
  }
  const valid = await verifyTotp(user.totpPendingSecret, body.code);
  if (!valid) throw new ApiError(401, "INVALID_2FA_CODE", "That code did not match — try again");

  const codes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpSecret: user.totpPendingSecret, totpPendingSecret: null },
    }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.twoFactorRecoveryCode.createMany({
      data: codes.map((code) => ({
        id: newId(),
        userId: user.id,
        codeHash: hashRecoveryCode(code),
      })),
    }),
  ]);

  // Privilege change → rotate the session itself (SRS §6.4).
  await revokeSession(session.id);
  const next = await createSession({
    userId: user.id,
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    stepUp: true,
    deviceName: session.deviceName,
  });
  setSessionCookies(res, next.session, next.refreshToken, true);
  await audit({
    actorId: user.id,
    action: "auth.2fa_enabled",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });

  res.json({ ok: true, recoveryCodes: codes });
});

authRouter.post("/2fa/disable", requireUser, async (req, res) => {
  const { user, session } = requireAuthed(req);
  limited(TWO_FACTOR_RULE, `2fa-disable:${user.id}`);
  if (!user.totpEnabled) {
    throw new ApiError(400, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not on");
  }
  await ensureStepUp(req);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, totpPendingSecret: null },
    }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);
  await stampStepUp(session.id);
  await audit({
    actorId: user.id,
    action: "auth.2fa_disabled",
    target: `user:${user.id}`,
    ip: clientIp(req),
  });
  res.json({ ok: true });
});

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const record = await prisma.twoFactorRecoveryCode.findFirst({
    where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
  });
  if (!record) return false;
  await prisma.twoFactorRecoveryCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  return true;
}

function deviceLabel(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const browser = /(Firefox|Edg|Chrome)\/[\d.]+/.exec(userAgent);
  const platform = /\(([^;)]+)/.exec(userAgent);
  const parts = [browser?.[1]?.replace("Edg", "Edge"), platform?.[1]?.split(";")[0]?.trim()];
  const label = parts.filter(Boolean).join(" / ");
  return label.slice(0, 80) || null;
}
