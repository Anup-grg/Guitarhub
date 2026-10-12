import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { env } from "../config.js";
import { fakePrisma } from "../test/fake-prisma.js";

const app = createApp();

type Profile = {
  sub?: string;
  id?: number;
  email?: string | null;
  email_verified?: boolean;
  name?: string | null;
  picture?: string | null;
  avatar_url?: string | null;
};

function stubProvider(profile: Profile) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return { ok: true, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("openidconnect.googleapis.com")) {
      return { ok: true, json: async () => profile };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callbackCookies(overrides: Record<string, string> = {}) {
  return {
    gh_oauth_state: "st-1",
    gh_oauth_pkce: "pkce-verifier",
    gh_oauth_mode: "login",
    ...overrides,
  };
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function seedSession(id: string, userId: string) {
  fakePrisma.seed("session", {
    id,
    userId,
    refreshTokenHash: `hash-${id}`,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  });
}

const googleProfile: Profile = {
  sub: "g-100",
  email: "ada@example.com",
  email_verified: true,
  name: "Ada L.",
  picture: "https://img",
};

beforeEach(() => {
  fakePrisma.reset();
  env.OAUTH_GOOGLE_CLIENT_ID = "";
  env.OAUTH_GOOGLE_CLIENT_SECRET = "";
  env.OAUTH_GITHUB_CLIENT_ID = "";
  env.OAUTH_GITHUB_CLIENT_SECRET = "";
});

afterEach(() => {
  env.OAUTH_GOOGLE_CLIENT_ID = "";
  env.OAUTH_GOOGLE_CLIENT_SECRET = "";
  vi.unstubAllGlobals();
});

function enableGoogle() {
  env.OAUTH_GOOGLE_CLIENT_ID = "cid";
  env.OAUTH_GOOGLE_CLIENT_SECRET = "secret";
}

describe("POST /api/v1/auth/oauth/:provider/link", () => {
  it("requires a signed-in session", async () => {
    enableGoogle();
    const res = await request(app).post("/api/v1/auth/oauth/google/link");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("404s for unknown or unconfigured providers", async () => {
    const unknown = await request(app).post("/api/v1/auth/oauth/steam/link");
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("OAUTH_PROVIDER_NOT_FOUND");

    fakePrisma.seed("user", { id: "u1", email: "u1@example.com", displayName: "U" });
    seedSession("sess-1", "u1");
    const unconfigured = await request(app)
      .post("/api/v1/auth/oauth/github/link")
      .set("Cookie", "gh_session=sess-1");
    expect(unconfigured.status).toBe(404);
    expect(unconfigured.body.code).toBe("OAUTH_NOT_CONFIGURED");
  });

  it("redirects with link-mode cookies when signed in", async () => {
    enableGoogle();
    fakePrisma.seed("user", { id: "u1", email: "u1@example.com", displayName: "U" });
    seedSession("sess-1", "u1");

    const res = await request(app)
      .post("/api/v1/auth/oauth/google/link")
      .set("Cookie", "gh_session=sess-1");

    expect(res.status).toBe(302);
    expect(String(res.headers.location)).toContain("accounts.google.com");
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.join(";")).toContain("gh_oauth_mode=link");
  });
});

describe("GET /api/v1/auth/oauth/:provider/callback", () => {
  it("creates an account, links the identity and signs the user in", async () => {
    enableGoogle();
    stubProvider(googleProfile);

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${env.APP_URL}/`);

    const users = fakePrisma.tables.user;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: "ada@example.com",
      displayName: "Ada L.",
      emailVerifiedAt: expect.any(Date),
      passwordHash: null,
      tosVersion: env.TOS_VERSION,
    });

    expect(fakePrisma.tables.authIdentity).toHaveLength(1);
    expect(fakePrisma.tables.authIdentity[0]).toMatchObject({
      provider: "google",
      providerUserId: "g-100",
    });

    const actions = fakePrisma.tables.auditLog.map((row) => row.action);
    expect(actions).toContain("auth.oauth_register");
    expect(actions).toContain("auth.oauth_login");

    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(cookies.join(";")).toContain("gh_session=");
    expect(fakePrisma.tables.session[0]).toMatchObject({ deviceName: "google sign-in" });
  });

  it("signs in an existing identity without creating a second user", async () => {
    enableGoogle();
    stubProvider(googleProfile);
    fakePrisma.seed("user", { id: "u1", email: "ada@example.com", displayName: "Ada" });
    fakePrisma.seed("authIdentity", {
      id: "ident-1",
      userId: "u1",
      provider: "google",
      providerUserId: "g-100",
    });

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${env.APP_URL}/`);
    expect(fakePrisma.tables.user).toHaveLength(1);
    expect(fakePrisma.tables.session).toHaveLength(1);
    const actions = fakePrisma.tables.auditLog.map((row) => row.action);
    expect(actions).toContain("auth.oauth_login");
    expect(actions).not.toContain("auth.oauth_register");
  });

  it("never auto-links when the provider email already has a password account", async () => {
    enableGoogle();
    stubProvider(googleProfile);
    fakePrisma.seed("user", { id: "u1", email: "ada@example.com", displayName: "Existing" });

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));

    expect(res.status).toBe(302);
    expect(String(res.headers.location)).toContain("error=oauth_email_taken");
    expect(fakePrisma.tables.user).toHaveLength(1);
    expect(fakePrisma.tables.session).toHaveLength(0);
    expect(String(res.headers["set-cookie"] ?? "")).not.toContain("gh_session=");
  });

  it("creates a fallback address when the provider shares no email", async () => {
    enableGoogle();
    stubProvider({ sub: "g-200", email: null, email_verified: false, name: null });

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));

    expect(res.status).toBe(302);
    expect(fakePrisma.tables.user[0]!.email).toBe("google-g-200@google.guitarhub.invalid");
    expect(fakePrisma.tables.user[0]!.displayName).toBe("google player");
    expect(fakePrisma.tables.user[0]!.emailVerifiedAt).toBeNull();
  });

  it("bounces banned and deleted accounts", async () => {
    enableGoogle();
    fakePrisma.seed("user", {
      id: "banned",
      email: "ada@example.com",
      displayName: "Banned",
      bannedAt: new Date(),
    });
    fakePrisma.seed("authIdentity", {
      id: "ident-1",
      userId: "banned",
      provider: "google",
      providerUserId: "g-100",
    });
    stubProvider(googleProfile);

    const banned = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));
    expect(String(banned.headers.location)).toContain("error=account_banned");
    expect(fakePrisma.tables.session).toHaveLength(0);

    fakePrisma.tables.user[0]!.bannedAt = null;
    fakePrisma.tables.user[0]!.deletedAt = new Date();
    const deleted = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));
    expect(String(deleted.headers.location)).toContain("error=account_deleted");
    expect(fakePrisma.tables.session).toHaveLength(0);
  });

  it("passes provider errors and state mismatches back to /login", async () => {
    enableGoogle();
    stubProvider(googleProfile);

    const denied = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ error: "access_denied", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies()));
    expect(String(denied.headers.location)).toContain("error=oauth_denied");

    const tampered = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "different" })
      .set("Cookie", cookieHeader(callbackCookies()));
    expect(String(tampered.headers.location)).toContain("error=oauth_state");
  });
});

describe("callback in link mode", () => {
  it("links the provider identity to the signed-in account", async () => {
    enableGoogle();
    stubProvider(googleProfile);
    fakePrisma.seed("user", { id: "u1", email: "u1@example.com", displayName: "U" });
    seedSession("sess-1", "u1");

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies({ gh_oauth_mode: "link", gh_session: "sess-1" })));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${env.APP_URL}/settings?linked=google`);
    expect(fakePrisma.tables.authIdentity).toHaveLength(1);
    expect(fakePrisma.tables.authIdentity[0]!.userId).toBe("u1");
    expect(fakePrisma.tables.auditLog.map((r) => r.action)).toContain("auth.identity_linked");
    expect(fakePrisma.tables.user).toHaveLength(1); // no second account
  });

  it("refuses to steal an identity owned by another account", async () => {
    enableGoogle();
    stubProvider(googleProfile);
    fakePrisma.seed("user", { id: "u1", email: "u1@example.com", displayName: "U" });
    fakePrisma.seed("user", { id: "u2", email: "u2@example.com", displayName: "Other" });
    fakePrisma.seed("authIdentity", {
      id: "ident-1",
      userId: "u2",
      provider: "google",
      providerUserId: "g-100",
    });
    seedSession("sess-1", "u1");

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies({ gh_oauth_mode: "link", gh_session: "sess-1" })));

    expect(String(res.headers.location)).toContain("settings?error=identity_taken");
    expect(fakePrisma.tables.authIdentity[0]!.userId).toBe("u2");
  });

  it("requires a live session when linking", async () => {
    enableGoogle();
    stubProvider(googleProfile);

    const res = await request(app)
      .get("/api/v1/auth/oauth/google/callback")
      .query({ code: "auth-code", state: "st-1" })
      .set("Cookie", cookieHeader(callbackCookies({ gh_oauth_mode: "link" })));

    expect(String(res.headers.location)).toContain("error=session_expired");
  });
});
