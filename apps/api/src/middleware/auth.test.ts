import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { env } from "../config.js";
import { ApiError } from "../errors/problem.js";
import { attachUser, csrfGuard, ensureStepUp, requireAuthed, requireUser } from "./auth.js";
import { hashPassword } from "../lib/password.js";
import { createTotpSecret } from "../lib/totp.js";
import { resetRateLimits } from "../lib/rate-limit.js";
import { generate } from "otplib";
import { sessionCookieName } from "../lib/session.js";
import { fakePrisma } from "../test/fake-prisma.js";

function makeReq(over: Record<string, unknown> = {}): Request {
  const headers = (over.headers ?? {}) as Record<string, string>;
  return {
    method: "POST",
    protocol: "http",
    cookies: {},
    body: {},
    get: (name: string) => headers[name.toLowerCase()],
    ...over,
  } as unknown as Request;
}

function nextSpy(): NextFunction & { calls: unknown[][] } {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
  }) as NextFunction & { calls: unknown[][] };
  fn.calls = [];
  return fn;
}

const res = {} as Response;

beforeEach(() => {
  fakePrisma.reset();
  resetRateLimits();
});

describe("csrfGuard (SRS §6.5)", () => {
  it("passes safe methods without inspecting the origin", () => {
    const next = nextSpy();
    csrfGuard(makeReq({ method: "GET", headers: { origin: "https://evil.example" } }), res, next);
    expect(next.calls).toEqual([[]]);
  });

  it("passes state-changing requests without an Origin header", () => {
    const next = nextSpy();
    csrfGuard(makeReq({ method: "POST" }), res, next);
    expect(next.calls).toEqual([[]]);
  });

  it("passes requests from the app origin and from our own host", () => {
    const fromApp = nextSpy();
    csrfGuard(makeReq({ method: "POST", headers: { origin: env.APP_URL } }), res, fromApp);
    expect(fromApp.calls).toEqual([[]]);

    const fromHost = nextSpy();
    csrfGuard(
      makeReq({
        method: "POST",
        headers: { origin: "http://localhost:4000", host: "localhost:4000" },
      }),
      res,
      fromHost,
    );
    expect(fromHost.calls).toEqual([[]]);
  });

  it("rejects state-changing requests from another origin", () => {
    const next = nextSpy();
    csrfGuard(makeReq({ method: "POST", headers: { origin: "https://evil.example" } }), res, next);

    expect(next.calls).toHaveLength(1);
    const err = next.calls[0]![0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("CSRF_ORIGIN_DENIED");
  });
});

describe("requireUser / requireAuthed", () => {
  it("rejects anonymous requests with 401", () => {
    const next = nextSpy();
    requireUser(makeReq(), res, next);

    const err = next.calls[0]![0] as ApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(() => requireAuthed(makeReq())).toThrowError(ApiError);
  });

  it("rejects banned accounts with 403", () => {
    const next = nextSpy();
    const user = fakePrisma.seed("user", {
      id: "u1",
      email: "u1@example.com",
      bannedAt: new Date(),
    });
    requireUser(makeReq({ auth: { user, session: {} } }), res, next);

    expect((next.calls[0]![0] as ApiError).code).toBe("ACCOUNT_BANNED");
  });

  it("lets shadow-banned accounts through so the ban stays invisible (FR-7.2)", () => {
    const next = nextSpy();
    const user = fakePrisma.seed("user", {
      id: "u1",
      email: "u1@example.com",
      bannedAt: new Date(),
      banType: "SHADOW",
    });
    requireUser(makeReq({ auth: { user, session: {} } }), res, next);

    expect(next.calls).toEqual([[]]);
  });

  it("lets signed-in users through and returns their context", () => {
    const next = nextSpy();
    const user = fakePrisma.seed("user", { id: "u1", email: "u1@example.com" });
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1" });
    const req = makeReq({ auth: { user, session } });

    requireUser(req, res, next);
    expect(next.calls).toEqual([[]]);
    expect(requireAuthed(req)).toEqual({ user, session });
  });
});

describe("attachUser", () => {
  it("hydrates req.auth from a valid session cookie and slides the idle window", async () => {
    const user = fakePrisma.seed("user", { id: "u1", email: "u1@example.com" });
    const session = fakePrisma.seed("session", {
      id: "s1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(0),
      createdAt: new Date(),
      revokedAt: null,
    });

    const next = nextSpy();
    const req = makeReq({ cookies: { [sessionCookieName()]: "s1" } });
    await attachUser(req, res, next);

    expect(next.calls).toEqual([[]]);
    expect(req.auth?.user.id).toBe(user.id);
    expect((fakePrisma.tables.session[0]!.lastSeenAt as Date).getTime()).toBeGreaterThan(
      Date.now() - 1000,
    );
    expect(session).toBeTruthy();
  });

  it("leaves req.auth unset for missing or invalid cookies", async () => {
    const next = nextSpy();

    const anonymous = makeReq();
    await attachUser(anonymous, res, next);
    expect(anonymous.auth).toBeUndefined();

    const bogus = makeReq({ cookies: { [sessionCookieName()]: "nope" } });
    await attachUser(bogus, res, next);
    expect(bogus.auth).toBeUndefined();
    expect(next.calls).toHaveLength(2);
  });
});

describe("ensureStepUp (SRS §6.3)", () => {
  async function setupUser(overrides: Record<string, unknown> = {}) {
    const passwordHash = await hashPassword("correct-horse-battery");
    const user = fakePrisma.seed("user", {
      id: "u1",
      email: "u1@example.com",
      passwordHash,
      totpEnabled: false,
      totpSecret: null,
      ...overrides,
    });
    return user as typeof user & Record<string, unknown>;
  }

  function reqWith(user: unknown, session: unknown, body: Record<string, unknown> = {}) {
    return makeReq({ auth: { user, session }, body });
  }

  it("accepts a session with a fresh step-up stamp", async () => {
    const user = await setupUser();
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: new Date() });

    await expect(ensureStepUp(reqWith(user, session))).resolves.toBeUndefined();
  });

  it("accepts the correct password and stamps the session", async () => {
    const user = await setupUser();
    const session = fakePrisma.seed("session", {
      id: "s1",
      userId: "u1",
      stepUpAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    await expect(
      ensureStepUp(reqWith(user, session, { password: "correct-horse-battery" })),
    ).resolves.toBeUndefined();

    expect(fakePrisma.tables.session[0]!.stepUpAt).toBeInstanceOf(Date);
  });

  it("rejects a wrong password", async () => {
    const user = await setupUser();
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: null });

    await expect(
      ensureStepUp(reqWith(user, session, { password: "wrong-password" })),
    ).rejects.toMatchObject({ status: 403, code: "STEP_UP_REQUIRED" });
  });

  it("demands credentials when the stamp has lapsed", async () => {
    const user = await setupUser();
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: null });

    await expect(ensureStepUp(reqWith(user, session, {}))).rejects.toMatchObject({
      status: 403,
      code: "STEP_UP_REQUIRED",
    });
  });

  it("accepts a valid TOTP code", async () => {
    const secret = createTotpSecret();
    const user = await setupUser({ totpEnabled: true, totpSecret: secret });
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: null });
    const code = await generate({ secret });

    await expect(ensureStepUp(reqWith(user, session, { totp: code }))).resolves.toBeUndefined();
  });

  it("rejects an incorrect TOTP code", async () => {
    const secret = createTotpSecret();
    const user = await setupUser({ totpEnabled: true, totpSecret: secret });
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: null });

    await expect(ensureStepUp(reqWith(user, session, { totp: "000000" }))).rejects.toMatchObject({
      code: "STEP_UP_REQUIRED",
    });
  });

  it("fails for passwordless accounts even with a password supplied", async () => {
    const user = await setupUser({ passwordHash: null });
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: null });

    await expect(
      ensureStepUp(reqWith(user, session, { password: "anything-at-all" })),
    ).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });

  it("rate limits repeated credential guesses from a stolen session", async () => {
    const user = await setupUser();
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: null });

    for (let i = 0; i < 10; i++) {
      await expect(
        ensureStepUp(reqWith(user, session, { password: "wrong-password" })),
      ).rejects.toMatchObject({ status: 403, code: "STEP_UP_REQUIRED" });
    }

    await expect(
      ensureStepUp(reqWith(user, session, { password: "wrong-password" })),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("does not rate limit a fresh step-up that needs no credentials", async () => {
    const user = await setupUser();
    const session = fakePrisma.seed("session", { id: "s1", userId: "u1", stepUpAt: new Date() });

    await expect(ensureStepUp(reqWith(user, session, {}))).resolves.toBeUndefined();
  });
});
