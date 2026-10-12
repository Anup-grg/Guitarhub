import type { Response } from "express";
import type { Session, User } from "@prisma/client";
import { env } from "../config.js";
import { prisma } from "./prisma.js";
import { newId } from "./id.js";
import { hashToken, randomToken } from "./tokens.js";

/** SRS §6.4: idle 7 d, absolute 30 d, step-up window 5 min. */
export const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const STEP_UP_MS = 5 * 60 * 1000;
/** Absolute expiry never moves while sliding. */
const SLIDE_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export type SessionWithUser = Session & { user: User };

export function sessionCookieName(): string {
  return env.COOKIE_SECURE ? "__Host-gh_session" : "gh_session";
}

export function refreshCookieName(): string {
  return env.COOKIE_SECURE ? "__Host-gh_refresh" : "gh_refresh";
}

function baseCookie() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
  };
}

function absoluteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ABSOLUTE_MS);
}

function slidingExpiry(createdAt: Date, now = new Date()): Date {
  const idle = new Date(now.getTime() + IDLE_MS);
  const cap = absoluteExpiry(createdAt);
  return idle < cap ? idle : cap;
}

export type CreateSessionInput = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  stepUp?: boolean;
  deviceName?: string | null;
};

export async function createSession(
  input: CreateSessionInput,
): Promise<{ session: Session; refreshToken: string }> {
  const refreshToken = randomToken();
  const now = new Date();
  const session = await prisma.session.create({
    data: {
      id: newId(),
      userId: input.userId,
      refreshFamily: newId(),
      refreshTokenHash: hashToken(refreshToken),
      usedHashes: [],
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      deviceName: input.deviceName ?? null,
      stepUpAt: input.stepUp ? now : null,
      lastSeenAt: now,
      createdAt: now,
      expiresAt: slidingExpiry(now, now),
    },
  });
  return { session, refreshToken };
}

/** Slides idle expiry, capped by the absolute lifetime anchored at session creation. */
export async function touchSession(session: Session): Promise<void> {
  const now = Date.now();
  const next = slidingExpiry(session.createdAt, new Date(now));
  const stale = !session.lastSeenAt || now - session.lastSeenAt.getTime() > SLIDE_WRITE_INTERVAL_MS;
  if (!stale && session.expiresAt.getTime() > now) return;
  await prisma.session.update({
    where: { id: session.id },
    data: { expiresAt: next, lastSeenAt: new Date(now) },
  });
}

/** Rotation on every refresh (SRS §6.4) — old hashes stay recorded for reuse detection. */
export async function rotateSession(session: Session): Promise<string> {
  const refreshToken = randomToken();
  const now = new Date();
  const used = [...session.usedHashes, session.refreshTokenHash].filter(
    (h): h is string => Boolean(h),
  );
  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashToken(refreshToken),
      usedHashes: used.slice(-8),
      expiresAt: slidingExpiry(session.createdAt, now),
      lastSeenAt: now,
    },
  });
  return refreshToken;
}

export async function revokeSession(id: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, exceptId?: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export async function stampStepUp(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { stepUpAt: new Date() },
  });
}

export function isStepUpFresh(session: Session, now = Date.now()): boolean {
  return Boolean(session.stepUpAt && now - session.stepUpAt.getTime() <= STEP_UP_MS);
}

export type LoadedSession =
  | { ok: true; session: SessionWithUser }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "revoked" };

/** Validates the opaque session cookie (no sliding write here — see touchSession). */
export async function loadSession(sessionId: string | undefined): Promise<LoadedSession> {
  if (!sessionId) return { ok: false, reason: "missing" };
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session) return { ok: false, reason: "invalid" };
  if (session.revokedAt) return { ok: false, reason: "revoked" };
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
  if (session.createdAt.getTime() + ABSOLUTE_MS <= now) return { ok: false, reason: "expired" };
  if (session.user.deletedAt) return { ok: false, reason: "revoked" };
  return { ok: true, session };
}

export function setSessionCookies(
  res: Response,
  session: Session,
  refreshToken: string,
  rememberMe: boolean,
): void {
  res.cookie(sessionCookieName(), session.id, {
    ...baseCookie(),
    ...(rememberMe ? { maxAge: ABSOLUTE_MS } : {}),
  });
  res.cookie(refreshCookieName(), refreshToken, {
    ...baseCookie(),
    path: "/api/v1/auth",
    ...(rememberMe ? { maxAge: ABSOLUTE_MS } : {}),
  });
}

export function clearAuthCookies(res: Response): void {
  const opts = { ...baseCookie(), path: "/" };
  res.clearCookie(sessionCookieName(), opts);
  res.clearCookie(refreshCookieName(), { ...opts, path: "/api/v1/auth" });
}
