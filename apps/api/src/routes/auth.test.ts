import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { env } from "../config.js";
import { outbox } from "../lib/mailer.js";
import { resetRateLimits } from "../lib/rate-limit.js";
import { fakePrisma } from "../test/fake-prisma.js";
import { generate } from "otplib";

const app = createApp();

const PASSWORD = "s3cure-guitar-passphrase";

function registration(overrides: Record<string, unknown> = {}) {
  return {
    email: "player@example.com",
    password: PASSWORD,
    displayName: "Player One",
    tosVersion: "1.0",
    acceptTerms: true,
    acceptGuidelines: true,
    ...overrides,
  };
}

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as string | string[] | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function tokenFromLastMail(): string {
  const mail = outbox[outbox.length - 1];
  const match = /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "");
  if (!match) throw new Error("no token in mail");
  return match[1]!;
}

beforeEach(() => {
  fakePrisma.reset();
  resetRateLimits();
  outbox.length = 0;
  env.OAUTH_GOOGLE_CLIENT_ID = "";
  env.OAUTH_GOOGLE_CLIENT_SECRET = "";
  env.OAUTH_GITHUB_CLIENT_ID = "";
  env.OAUTH_GITHUB_CLIENT_SECRET = "";
});

describe("POST /api/v1/auth/register", () => {
  it("creates an account, signs the user in and emails a verification link", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/v1/auth/register").send(registration());

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: "player@example.com",
      displayName: "Player One",
      emailVerified: false,
      role: "USER",
      hasPassword: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("$argon2id$");

    const cookies = cookiesOf(res);
    expect(cookies.join(";")).toContain("gh_session=");
    expect(cookies.join(";")).toContain("gh_refresh=");
    expect(cookies.join(";")).toContain("HttpOnly");

    expect(fakePrisma.tables.user).toHaveLength(1);
    expect(fakePrisma.tables.session).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("player@example.com");

    const me = await agent.get("/api/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("player@example.com");
  });

  it("records the accepted policy version", async () => {
    await request(app).post("/api/v1/auth/register").send(registration()).expect(201);
    expect(fakePrisma.tables.user[0]).toMatchObject({
      tosVersion: "1.0",
      tosAcceptedAt: expect.any(Date),
    });
  });

  it("rejects a duplicate email with 409 EMAIL_TAKEN", async () => {
    await request(app).post("/api/v1/auth/register").send(registration()).expect(201);
    const res = await request(app).post("/api/v1/auth/register").send(registration());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
    expect(fakePrisma.tables.user).toHaveLength(1);
  });

  it("rejects passwords shorter than 12 characters", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(registration({ password: "short" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(fakePrisma.tables.user).toHaveLength(0);
  });

  it("requires both ToS and Community Guidelines checkboxes", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(registration({ acceptGuidelines: false }));
    expect(res.status).toBe(400);
    expect(res.body.issues?.[0]?.message).toMatch(/Community Guidelines/);
  });

  it("rejects malformed emails", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(registration({ email: "no" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/login", () => {
  beforeEach(async () => {
    await request(app).post("/api/v1/auth/register").send(registration()).expect(201);
    outbox.length = 0;
  });

  it("signs in with valid credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("player@example.com");
    expect(cookiesOf(res).join(";")).toContain("gh_session=");
  });

  it("returns the same generic error for a wrong password and an unknown email", async () => {
    const wrongPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: "wrong-password-123" });
    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@example.com", password: "wrong-password-123" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.code).toBe(unknownEmail.body.code);
    expect(wrongPassword.body.title).toBe(unknownEmail.body.title);
    expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
  });

  it("blocks banned accounts only after the password checks out", async () => {
    const user = fakePrisma.tables.user[0]!;
    user.bannedAt = new Date();

    const badPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: "wrong-password-123" });
    expect(badPassword.status).toBe(401);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BANNED");
  });

  it("rate limits repeated failures for one account", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "player@example.com", password: "wrong-password-123" })
        .expect(401);
    }
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: "wrong-password-123" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBeTruthy();
  });
});

describe("CSRF origin guard", () => {
  it("rejects state-changing requests from another origin", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", "https://evil.example")
      .send(registration());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_DENIED");
    expect(fakePrisma.tables.user).toHaveLength(0);
  });

  it("accepts requests from the configured app origin", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", env.APP_URL)
      .send(registration());
    expect(res.status).toBe(201);
  });

  it("does not apply the guard to GET requests", async () => {
    const res = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
  });
});

describe("email verification", () => {
  it("confirms the address from the emailed token", async () => {
    await request(app).post("/api/v1/auth/register").send(registration()).expect(201);
    const token = tokenFromLastMail();

    const res = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
    expect(fakePrisma.tables.user[0]!.emailVerifiedAt).toBeInstanceOf(Date);

    const replay = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });
});

describe("password reset", () => {
  it("always answers 202, mails only real accounts, and rotates the password", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);
    outbox.length = 0;

    const unknown = await request(app)
      .post("/api/v1/auth/password/forgot")
      .send({ email: "ghost@example.com" });
    expect(unknown.status).toBe(202);
    expect(outbox).toHaveLength(0);

    const known = await request(app)
      .post("/api/v1/auth/password/forgot")
      .send({ email: "player@example.com" });
    expect(known.status).toBe(202);
    expect(outbox).toHaveLength(1);

    const token = tokenFromLastMail();
    const reset = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ token, password: "a-brand-new-passphrase-9" });
    expect(reset.status).toBe(200);

    const oldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(oldPassword.status).toBe(401);

    const newPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: "a-brand-new-passphrase-9" });
    expect(newPassword.status).toBe(200);

    // All pre-reset sessions are revoked.
    const me = await agent.get("/api/v1/me");
    expect(me.status).toBe(401);
  });
});

describe("password change", () => {
  it("requires the current password, rotates it, and keeps only this session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);
    const other = await request(app)
      .post("/api/v1/auth/register")
      .send(registration({ email: "second@example.com" }))
      .expect(201);

    const bad = await agent
      .post("/api/v1/auth/password/change")
      .send({ currentPassword: "wrong-password-123", newPassword: "a-new-passphrase-11" });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe("INVALID_CREDENTIALS");

    const ok = await agent
      .post("/api/v1/auth/password/change")
      .send({ currentPassword: PASSWORD, newPassword: "a-new-passphrase-11" });
    expect(ok.status).toBe(200);

    const oldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(oldPassword.status).toBe(401);

    const me = await agent.get("/api/v1/me");
    expect(me.status).toBe(200);

    // Another user's sessions are untouched.
    const otherMe = await request(app).get("/api/v1/me").set("Cookie", cookiesOf(other));
    expect(otherMe.status).toBe(200);
  });
});

describe("sessions: refresh, reuse detection, logout", () => {
  it("rotates the refresh token and detects replay of the old one", async () => {
    const login = await request(app)
      .post("/api/v1/auth/register")
      .send(registration());
    const firstRefresh = cookiesOf(login)
      .find((c) => c.startsWith("gh_refresh="))!
      .split(";")[0]!;

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstRefresh);
    expect(refreshed.status).toBe(200);
    const secondRefresh = cookiesOf(refreshed)
      .find((c) => c.startsWith("gh_refresh="))!
      .split(";")[0]!;
    expect(secondRefresh).not.toBe(firstRefresh);

    // Replaying the rotated-away token revokes the whole session family.
    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstRefresh);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("SESSION_REUSE_DETECTED");
    expect(fakePrisma.tables.session[0]!.revokedAt).toBeInstanceOf(Date);

    const afterRevocation = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", secondRefresh);
    expect(afterRevocation.status).toBe(401);
  });

  it("refreshes a valid session and returns the current user", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);
    const res = await agent.post("/api/v1/auth/refresh");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("player@example.com");
  });

  it("rejects refresh without a cookie", async () => {
    const res = await request(app).post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_EXPIRED");
  });

  it("logout revokes the session everywhere", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);
    expect((await agent.get("/api/v1/me")).status).toBe(200);

    const out = await agent.post("/api/v1/auth/logout");
    expect(out.status).toBe(200);
    expect((await agent.get("/api/v1/me")).status).toBe(401);
    expect(fakePrisma.tables.session.every((s) => s.revokedAt)).toBe(true);
  });
});

describe("two-factor authentication", () => {
  it("enables TOTP, returns recovery codes once, and gates login", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);

    const setup = await agent.post("/api/v1/auth/2fa/setup");
    expect(setup.status).toBe(200);
    expect(setup.body.uri).toContain("otpauth://totp/GuitarHub:");
    expect(fakePrisma.tables.user[0]!.totpPendingSecret).toBe(setup.body.secret);

    const code = await generate({ secret: setup.body.secret });
    const verify = await agent.post("/api/v1/auth/2fa/verify").send({ code });
    expect(verify.status).toBe(200);
    expect(verify.body.recoveryCodes).toHaveLength(10);
    expect(fakePrisma.tables.user[0]!.totpEnabled).toBe(true);
    expect(fakePrisma.tables.twoFactorRecoveryCode).toHaveLength(10);

    await agent.post("/api/v1/auth/logout").expect(200);

    const noCode = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(noCode.status).toBe(403);
    expect(noCode.body.code).toBe("TWO_FACTOR_REQUIRED");

    const badCode = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD, totp: "000000" });
    expect(badCode.status).toBe(401);
    expect(badCode.body.code).toBe("INVALID_2FA_CODE");

    const freshCode = await generate({ secret: setup.body.secret });
    const good = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD, totp: freshCode });
    expect(good.status).toBe(200);

    // Recovery code path — single use.
    const recovery = verify.body.recoveryCodes[0];
    const first = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD, recoveryCode: recovery });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD, recoveryCode: recovery });
    expect(second.status).toBe(401);
  });

  it("requires an enabled state before setup verification", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);
    const res = await agent.post("/api/v1/auth/2fa/verify").send({ code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TWO_FACTOR_NOT_PENDING");
  });

  it("disables TOTP when the session step-up is fresh", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(registration()).expect(201);
    const setup = await agent.post("/api/v1/auth/2fa/setup").expect(200);
    const code = await generate({ secret: setup.body.secret });
    await agent.post("/api/v1/auth/2fa/verify").send({ code }).expect(200);

    const res = await agent
      .post("/api/v1/auth/2fa/disable")
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(fakePrisma.tables.user[0]!.totpEnabled).toBe(false);
    expect(fakePrisma.tables.twoFactorRecoveryCode).toHaveLength(0);
  });
});

describe("GET /api/v1/auth/oauth/:provider", () => {
  it("404s for unknown providers", async () => {
    const res = await request(app).get("/api/v1/auth/oauth/steam");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("OAUTH_PROVIDER_NOT_FOUND");
  });

  it("404s when the provider is not configured", async () => {
    const res = await request(app).get("/api/v1/auth/oauth/google");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("OAUTH_NOT_CONFIGURED");
  });

  it("redirects to Google with PKCE + state and sets the state cookie", async () => {
    env.OAUTH_GOOGLE_CLIENT_ID = "cid";
    env.OAUTH_GOOGLE_CLIENT_SECRET = "secret";
    const res = await request(app).get("/api/v1/auth/oauth/google");
    expect(res.status).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("redirect_uri") ?? "").toContain(
      "/api/v1/auth/oauth/google/callback",
    );
    const oauthCookies = cookiesOf(res);
    expect(oauthCookies.join(";")).toContain("gh_oauth_state=");
    expect(oauthCookies.join(";")).toContain("gh_oauth_pkce=");
  });

  it("bounces back with oauth_state when the callback state does not match", async () => {
    env.OAUTH_GOOGLE_CLIENT_ID = "cid";
    env.OAUTH_GOOGLE_CLIENT_SECRET = "secret";
    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "abc", state: "tampered" })
      .set("Cookie", "gh_oauth_state=original");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error=oauth_state");
  });
});
