import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { env } from "../config.js";
import { fakePrisma } from "../test/fake-prisma.js";
import { hashToken } from "./tokens.js";
import {
  ABSOLUTE_MS,
  IDLE_MS,
  STEP_UP_MS,
  clearAuthCookies,
  createSession,
  isStepUpFresh,
  loadSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  sessionCookieName,
  refreshCookieName,
  setSessionCookies,
  stampStepUp,
  touchSession,
} from "./session.js";

function seedUser(id = "user-1") {
  return fakePrisma.seed("user", { id, email: `${id}@example.com`, displayName: id });
}

function seedSession(overrides: Record<string, unknown> = {}) {
  const row = fakePrisma.seed("session", {
    id: "session-1",
    userId: "user-1",
    refreshFamily: "family-1",
    refreshTokenHash: hashToken("current-token"),
    usedHashes: [],
    expiresAt: new Date(Date.now() + IDLE_MS),
    createdAt: new Date(),
    ...overrides,
  });
  return row as Record<string, unknown>;
}

beforeEach(() => {
  fakePrisma.reset();
  env.COOKIE_SECURE = false;
});

describe("createSession", () => {
  it("stores only the hash of the refresh token", async () => {
    seedUser();
    const { session, refreshToken } = await createSession({ userId: "user-1", ip: "1.2.3.4" });

    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.refreshTokenHash).toBe(hashToken(refreshToken));
    expect(session.refreshTokenHash).not.toBe(refreshToken);
    expect(session.usedHashes).toEqual([]);
    expect(session.ip).toBe("1.2.3.4");
    expect(session.stepUpAt).toBeNull();
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(IDLE_MS);
    expect(fakePrisma.tables.session).toHaveLength(1);
  });

  it("marks a step-up session when requested and truncates the user agent", async () => {
    seedUser();
    const ua = "Mozilla/5.0 ".repeat(50); // > 300 chars
    const { session } = await createSession({
      userId: "user-1",
      userAgent: ua,
      stepUp: true,
      deviceName: "Chrome / Windows",
    });

    expect(session.stepUpAt).toBeInstanceOf(Date);
    expect(session.userAgent!.length).toBe(300);
    expect(session.deviceName).toBe("Chrome / Windows");
  });
});

describe("rotateSession", () => {
  it("issues a new hash and remembers the old one for reuse detection", async () => {
    seedUser();
    const { session, refreshToken } = await createSession({ userId: "user-1" });

    const next = await rotateSession(session);
    expect(next).not.toBe(refreshToken);

    const row = fakePrisma.tables.session[0]!;
    expect(row.refreshTokenHash).toBe(hashToken(next));
    expect(row.usedHashes as string[]).toContain(hashToken(refreshToken));
  });

  it("keeps at most 8 remembered hashes", async () => {
    seedUser();
    const { session } = await createSession({ userId: "user-1" });
    let current = session;
    for (let i = 0; i < 12; i++) {
      await rotateSession(current);
      current = fakePrisma.tables.session[0] as never;
    }
    expect((fakePrisma.tables.session[0]!.usedHashes as unknown[]).length).toBe(8);
  });

  it("slides expiry but never past the absolute lifetime", async () => {
    seedUser();
    const createdAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    await createSession({ userId: "user-1" });
    fakePrisma.tables.session[0]!.createdAt = createdAt;

    await rotateSession(fakePrisma.tables.session[0]! as never);

    const row = fakePrisma.tables.session[0]!;
    expect((row.expiresAt as Date).getTime()).toBe(createdAt.getTime() + ABSOLUTE_MS);
  });
});

describe("touchSession", () => {
  it("does not write when the session was touched recently", async () => {
    seedUser();
    seedSession({ lastSeenAt: new Date() });
    const before = new Date(fakePrisma.tables.session[0]!.lastSeenAt as Date);

    await touchSession(fakePrisma.tables.session[0]! as never);

    expect(fakePrisma.tables.session[0]!.lastSeenAt).toEqual(before);
  });

  it("slides idle expiry once the last touch is older than an hour", async () => {
    seedUser();
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    seedSession({ lastSeenAt: stale, expiresAt: new Date(Date.now() + 60_000) });
    const session = fakePrisma.tables.session[0]!;

    await touchSession(session as never);

    const row = fakePrisma.tables.session[0]!;
    expect((row.lastSeenAt as Date).getTime()).toBeGreaterThan(Date.now() - 1000);
    expect((row.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + IDLE_MS - 60_000);
  });

  it("never slides beyond the absolute 30-day cap", async () => {
    seedUser();
    const createdAt = new Date(Date.now() - 29.5 * 24 * 60 * 60 * 1000);
    seedSession({ createdAt, lastSeenAt: new Date(0), expiresAt: new Date(0) });

    await touchSession(fakePrisma.tables.session[0]! as never);

    expect((fakePrisma.tables.session[0]!.expiresAt as Date).getTime()).toBe(
      createdAt.getTime() + ABSOLUTE_MS,
    );
  });
});

describe("revocation", () => {
  it("revokes a single session and is idempotent", async () => {
    seedUser();
    seedSession();

    await revokeSession("session-1");
    await revokeSession("session-1");

    expect(fakePrisma.tables.session[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it("revokes every session except the one we keep", async () => {
    seedUser();
    seedSession({ id: "session-1" });
    fakePrisma.seed("session", { id: "session-2", userId: "user-1", refreshTokenHash: "h2" });
    fakePrisma.seed("session", { id: "session-3", userId: "user-1", refreshTokenHash: "h3" });

    const count = await revokeAllSessions("user-1", "session-2");

    expect(count).toBe(2);
    expect(fakePrisma.tables.session.find((s) => s.id === "session-2")!.revokedAt).toBeNull();
    expect(
      fakePrisma.tables.session.filter((s) => s.id !== "session-2").every((s) => s.revokedAt),
    ).toBe(true);
  });
});

describe("step-up freshness", () => {
  it("accepts a stamp inside the 5-minute window and rejects older ones", async () => {
    expect(isStepUpFresh({ stepUpAt: new Date() } as never)).toBe(true);
    expect(
      isStepUpFresh({ stepUpAt: new Date(Date.now() - STEP_UP_MS) } as never, Date.now()),
    ).toBe(true);
    expect(
      isStepUpFresh({ stepUpAt: new Date(Date.now() - STEP_UP_MS - 1) } as never, Date.now()),
    ).toBe(false);
    expect(isStepUpFresh({ stepUpAt: null } as never)).toBe(false);
  });

  it("stampStepUp writes the current time", async () => {
    seedUser();
    seedSession({ stepUpAt: null });

    await stampStepUp("session-1");

    expect(fakePrisma.tables.session[0]!.stepUpAt).toBeInstanceOf(Date);
  });
});

describe("loadSession", () => {
  it("reports the reason a cookie is unusable", async () => {
    expect(await loadSession(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(await loadSession("does-not-exist")).toEqual({ ok: false, reason: "invalid" });

    seedUser();
    seedSession({ revokedAt: new Date() });
    expect(await loadSession("session-1")).toEqual({ ok: false, reason: "revoked" });
    fakePrisma.reset();

    seedUser();
    seedSession({ expiresAt: new Date(Date.now() - 1000) });
    expect(await loadSession("session-1")).toEqual({ ok: false, reason: "expired" });
    fakePrisma.reset();

    seedUser();
    seedSession({ createdAt: new Date(Date.now() - ABSOLUTE_MS - 1000) });
    expect(await loadSession("session-1")).toEqual({ ok: false, reason: "expired" });
    fakePrisma.reset();

    seedUser();
    seedSession();
    fakePrisma.tables.user[0]!.deletedAt = new Date();
    expect(await loadSession("session-1")).toEqual({ ok: false, reason: "revoked" });
  });

  it("loads a live session together with its user", async () => {
    seedUser();
    seedSession();

    const result = await loadSession("session-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe("session-1");
      expect(result.session.user.email).toBe("user-1@example.com");
    }
  });
});

describe("cookies", () => {
  it("switches to __Host- prefixed names when cookies must be secure", () => {
    env.COOKIE_SECURE = false;
    expect(sessionCookieName()).toBe("gh_session");
    expect(refreshCookieName()).toBe("gh_refresh");

    env.COOKIE_SECURE = true;
    expect(sessionCookieName()).toBe("__Host-gh_session");
    expect(refreshCookieName()).toBe("__Host-gh_refresh");
    env.COOKIE_SECURE = false;
  });

  function fakeResponse() {
    const cookies: { name: string; value: unknown; opts: Record<string, unknown> }[] = [];
    const cleared: { name: string; opts: Record<string, unknown> }[] = [];
    const res = {
      cookie(name: string, value: unknown, opts: Record<string, unknown>) {
        cookies.push({ name, value, opts });
      },
      clearCookie(name: string, opts: Record<string, unknown>) {
        cleared.push({ name, opts });
      },
    } as unknown as Response;
    return { res, cookies, cleared };
  }

  it("sets an HttpOnly session cookie and a path-scoped refresh cookie", async () => {
    seedUser();
    const { session, refreshToken } = await createSession({ userId: "user-1" });
    const { res, cookies } = fakeResponse();

    setSessionCookies(res, session, refreshToken, false);

    expect(cookies).toHaveLength(2);
    const sessionCookie = cookies.find((c) => c.name === "gh_session")!;
    const refreshCookie = cookies.find((c) => c.name === "gh_refresh")!;
    expect(sessionCookie.value).toBe(session.id);
    expect(sessionCookie.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(sessionCookie.opts.maxAge).toBeUndefined();
    expect(refreshCookie.value).toBe(refreshToken);
    expect(refreshCookie.opts.path).toBe("/api/v1/auth");
    expect(refreshCookie.opts.httpOnly).toBe(true);
  });

  it("gives remember-me sessions a persistent maxAge", async () => {
    seedUser();
    const { session, refreshToken } = await createSession({ userId: "user-1" });
    const { res, cookies } = fakeResponse();

    setSessionCookies(res, session, refreshToken, true);

    for (const cookie of cookies) expect(cookie.opts.maxAge).toBe(ABSOLUTE_MS);
  });

  it("clears both cookies on logout with matching paths", async () => {
    const { res, cleared } = fakeResponse();

    clearAuthCookies(res);

    expect(cleared.map((c) => c.name).sort()).toEqual(["gh_refresh", "gh_session"]);
    expect(cleared.find((c) => c.name === "gh_session")!.opts.path).toBe("/");
    expect(cleared.find((c) => c.name === "gh_refresh")!.opts.path).toBe("/api/v1/auth");
  });
});
