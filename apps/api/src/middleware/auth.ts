import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Session, User } from "@prisma/client";
import { ApiError } from "../errors/problem.js";
import { checkRate, rateLimited, type RateLimitRule } from "../lib/rate-limit.js";
import { burnPasswordTime, verifyPassword } from "../lib/password.js";
import { verifyTotp } from "../lib/totp.js";
import {
  clearAuthCookies,
  isStepUpFresh,
  loadSession,
  sessionCookieName,
  stampStepUp,
  touchSession,
} from "../lib/session.js";
import { env } from "../config.js";
import { isHardBanned } from "../lib/users.js";

export type AuthContext = { user: User; session: Session };

/** Caps how many times a single account may re-enter credentials for step-up (SRS §6.3). */
const STEP_UP_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 10 };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Loads the session cookie into `req.auth` (and slides its idle expiry). */
export const attachUser: RequestHandler = async (req, _res, next) => {
  const result = await loadSession(req.cookies?.[sessionCookieName()]);
  if (result.ok) {
    req.auth = { user: result.session.user, session: result.session };
    await touchSession(result.session);
  }
  next();
};

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new ApiError(401, "UNAUTHORIZED", "Sign in to continue"));
    return;
  }
  if (isHardBanned(req.auth.user)) {
    next(new ApiError(403, "ACCOUNT_BANNED", "This account is suspended"));
    return;
  }
  next();
};

/** SRS §6.5 — state-changing requests must come from our own origin. */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.get("origin");
  if (!origin) {
    next(); // non-browser client (no Origin header) — SameSite=Lax still applies
    return;
  }
  const allowed = new Set<string>([env.APP_URL, `${req.protocol}://${req.get("host") ?? ""}`]);
  if (allowed.has(origin.replace(/\/$/, ""))) {
    next();
    return;
  }
  next(new ApiError(403, "CSRF_ORIGIN_DENIED", "Request blocked: untrusted origin"));
};

export function rateLimit(rule: RateLimitRule, keyFn: (req: Request) => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = checkRate(keyFn(req), rule);
    if (result.allowed) {
      next();
      return;
    }
    res.set("Retry-After", String(result.retryAfterSec));
    next(new ApiError(429, "RATE_LIMITED", "Too many requests — try again shortly"));
  };
}

export function requireAuthed(req: Request): AuthContext {
  if (!req.auth) throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue");
  return req.auth;
}

/**
 * Sensitive actions (SRS §6.3): re-enter password / TOTP code, or a step-up
 * stamped within the last 5 minutes (fresh login counts).
 */
export async function ensureStepUp(req: Request): Promise<void> {
  const { user, session } = requireAuthed(req);
  if (isStepUpFresh(session)) return;

  const body = (req.body ?? {}) as { password?: unknown; totp?: unknown };
  const password =
    typeof body.password === "string" && body.password.length > 0 ? body.password : null;
  const totp = typeof body.totp === "string" && body.totp.length > 0 ? body.totp : null;

  // A hijacked session must not allow unlimited password / TOTP guessing.
  if (password || totp) {
    const result = checkRate(`stepup:${user.id}`, STEP_UP_RULE);
    if (!result.allowed) rateLimited(result, "Too many confirmation attempts — try again shortly");
  }

  if (password) {
    const ok = user.passwordHash
      ? await verifyPassword(user.passwordHash, password)
      : await burnAndFail(password);
    if (!ok) throw new ApiError(403, "STEP_UP_REQUIRED", "Password re-entered incorrectly");
    await stampStepUp(session.id);
    req.auth = { user, session: { ...session, stepUpAt: new Date() } };
    return;
  }

  if (user.totpEnabled && user.totpSecret && totp) {
    const ok = await verifyTotp(user.totpSecret, totp);
    if (!ok) throw new ApiError(403, "STEP_UP_REQUIRED", "Two-factor code is incorrect");
    await stampStepUp(session.id);
    req.auth = { user, session: { ...session, stepUpAt: new Date() } };
    return;
  }

  throw new ApiError(
    403,
    "STEP_UP_REQUIRED",
    "Confirm your identity: re-enter your password or two-factor code",
  );
}

async function burnAndFail(password: string): Promise<false> {
  await burnPasswordTime(password);
  return false;
}

export function clearAuthContext(res: Response): void {
  clearAuthCookies(res);
}
