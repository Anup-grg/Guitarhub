import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { outbox } from "../lib/mailer.js";
import { resetRateLimits } from "../lib/rate-limit.js";
import { fakePrisma } from "../test/fake-prisma.js";

const app = createApp();
const PASSWORD = "s3cure-guitar-passphrase";

function registration() {
  return {
    email: "player@example.com",
    password: PASSWORD,
    displayName: "Player One",
    tosVersion: "1.0",
    acceptTerms: true,
    acceptGuidelines: true,
  };
}

function tokenFromLastMail(): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(outbox[outbox.length - 1]?.text ?? "");
  if (!match) throw new Error("no token in mail");
  return match[1]!;
}

async function signedInAgent() {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send(registration());
  expect(res.status).toBe(201);
  return agent;
}

beforeEach(() => {
  fakePrisma.reset();
  resetRateLimits();
  outbox.length = 0;
});

describe("GET /api/v1/me", () => {
  it("401s when signed out", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("returns the private self profile and empty gear list when signed in", async () => {
    const agent = await signedInAgent();
    const res = await agent.get("/api/v1/me");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "player@example.com",
      emailVerified: false,
      hasPassword: true,
      role: "USER",
    });
    expect(res.body.gear).toEqual([]);
  });
});

describe("PATCH /api/v1/me", () => {
  it("updates display name, bio and links", async () => {
    const agent = await signedInAgent();
    const res = await agent.patch("/api/v1/me").send({
      displayName: "Axe Handler",
      bio: "Mostly chugs.",
      links: [{ label: "Site", url: "https://example.com" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      displayName: "Axe Handler",
      bio: "Mostly chugs.",
      links: [{ label: "Site", url: "https://example.com" }],
    });
  });

  it("ignores server-set fields (mass-assignment protection)", async () => {
    const agent = await signedInAgent();
    const res = await agent.patch("/api/v1/me").send({
      role: "ADMIN",
      verified: true,
      emailVerified: true,
      bannedAt: "2026-01-01T00:00:00Z",
      displayName: "Sneaky",
    });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("Sneaky");
    expect(res.body.user.role).toBe("USER");
    expect(res.body.user.verified).toBe(false);
    expect(res.body.user.bannedAt).toBeNull();
    expect(fakePrisma.tables.user[0]).toMatchObject({ role: "USER", verified: false });
  });

  it("rejects invalid links", async () => {
    const agent = await signedInAgent();
    const res = await agent
      .patch("/api/v1/me")
      .send({ links: [{ label: "Bad", url: "javascript:alert(1)" }] });
    expect(res.status).toBe(400);
  });

  it("stages an email change and confirms it from the emailed token", async () => {
    const agent = await signedInAgent();
    outbox.length = 0;

    const res = await agent.patch("/api/v1/me").send({ email: "new-address@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.emailChangePending).toBe(true);
    expect(res.body.user.email).toBe("player@example.com");
    expect(res.body.user.pendingEmail).toBe("new-address@example.com");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("new-address@example.com");

    const verified = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({ token: tokenFromLastMail() });
    expect(verified.status).toBe(200);
    expect(verified.body.user.email).toBe("new-address@example.com");
    expect(verified.body.user.pendingEmail).toBeNull();
  });

  it("refuses an email that belongs to someone else", async () => {
    const agent = await signedInAgent();
    fakePrisma.seed("user", { id: "other-user", email: "taken@example.com" });
    const res = await agent.patch("/api/v1/me").send({ email: "taken@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("requires step-up for an email change once the window has lapsed", async () => {
    const agent = await signedInAgent();
    const session = fakePrisma.tables.session[0]!;
    session.stepUpAt = new Date(Date.now() - 10 * 60 * 1000);

    const blocked = await agent.patch("/api/v1/me").send({ email: "fresh@example.com" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("STEP_UP_REQUIRED");

    const allowed = await agent
      .patch("/api/v1/me")
      .send({ email: "fresh@example.com", password: PASSWORD });
    expect(allowed.status).toBe(200);
    expect(allowed.body.user.pendingEmail).toBe("fresh@example.com");
  });

  it("replaces the pedal gear list after validating pedal ids", async () => {
    fakePrisma.seed("pedal", {
      id: "pedal_helix",
      brand: "Line 6",
      model: "Helix",
      slug: "line6-helix",
      validationMode: "DEEP_JSON",
      extensions: [".hlx"],
    });
    const agent = await signedInAgent();

    const bad = await agent.patch("/api/v1/me").send({ gear: [{ pedalId: "nope" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("UNKNOWN_PEDAL");

    const ok = await agent
      .patch("/api/v1/me")
      .send({ gear: [{ pedalId: "pedal_helix", firmwareVersion: "3.70" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.gear).toHaveLength(1);
    expect(ok.body.gear[0]).toMatchObject({
      pedalId: "pedal_helix",
      firmwareVersion: "3.70",
      pedal: expect.objectContaining({ slug: "line6-helix" }),
    });

    const cleared = await agent.patch("/api/v1/me").send({ gear: [] });
    expect(cleared.body.gear).toEqual([]);
  });
});

describe("GET/PATCH/DELETE session management", () => {
  it("lists sessions with the current one flagged and revokes others", async () => {
    const agent = await signedInAgent();
    const other = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(other.status).toBe(200);

    const list = await agent.get("/api/v1/me/sessions");
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(2);
    const current = list.body.sessions.filter((s: { current: boolean }) => s.current);
    expect(current).toHaveLength(1);

    const otherSession = list.body.sessions.find((s: { current: boolean }) => !s.current);
    const revoke = await agent.delete(`/api/v1/me/sessions/${otherSession.id}`);
    expect(revoke.status).toBe(200);

    const after = await agent.get("/api/v1/me/sessions");
    expect(after.body.sessions).toHaveLength(1);
  });

  it("404s when revoking someone else's session", async () => {
    const agent = await signedInAgent();
    const res = await agent.delete("/api/v1/me/sessions/someone-elses-session");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
  });

  it("signs out everywhere", async () => {
    const agent = await signedInAgent();
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD })
      .expect(200);

    const res = await agent.delete("/api/v1/me/sessions");
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);
    expect((await agent.get("/api/v1/me")).status).toBe(401);
    expect(fakePrisma.tables.session.every((s) => s.revokedAt)).toBe(true);
  });
});

describe("POST /api/v1/me/step-up", () => {
  it("stamps a step-up after verifying the password", async () => {
    const agent = await signedInAgent();
    const session = fakePrisma.tables.session[0]!;
    session.stepUpAt = null;

    const blocked = await agent.post("/api/v1/me/step-up").send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("STEP_UP_REQUIRED");

    const ok = await agent.post("/api/v1/me/step-up").send({ password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(fakePrisma.tables.session[0]!.stepUpAt).toBeInstanceOf(Date);
  });

  it("rejects a wrong password", async () => {
    const agent = await signedInAgent();
    fakePrisma.tables.session[0]!.stepUpAt = null;
    const res = await agent.post("/api/v1/me/step-up").send({ password: "wrong-password-123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("STEP_UP_REQUIRED");
  });
});

describe("account deletion (FR-1.7)", () => {
  it("requires an explicit confirmation", async () => {
    const agent = await signedInAgent();
    const res = await agent.delete("/api/v1/me").send({ presetAction: "anonymize" });
    expect(res.status).toBe(400);
    expect(fakePrisma.tables.user[0]!.deletedAt).toBeNull();
  });

  it("soft-deletes, scrubs PII, revokes sessions and hides the profile", async () => {
    const agent = await signedInAgent();
    fakePrisma.seed("preset", { id: "preset_1", userId: fakePrisma.tables.user[0]!.id });

    const res = await agent
      .delete("/api/v1/me")
      .send({ confirm: "DELETE", presetAction: "remove", password: PASSWORD });
    expect(res.status).toBe(200);

    const user = fakePrisma.tables.user[0]!;
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(user.displayName).toBe("Deleted user");
    expect(user.email).toContain("@deleted.invalid");
    expect(user.passwordHash).toBeNull();
    expect(fakePrisma.tables.preset).toHaveLength(0);
    expect(fakePrisma.tables.session.every((s) => s.revokedAt)).toBe(true);
    expect((await agent.get("/api/v1/me")).status).toBe(401);

    // Deleted accounts cannot sign back in.
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(login.status).toBe(401);
  });
});

describe("linked sign-in methods", () => {
  it("lists and unlinks OAuth identities when a password exists", async () => {
    const agent = await signedInAgent();
    fakePrisma.seed("authIdentity", {
      id: "ident_1",
      userId: fakePrisma.tables.user[0]!.id,
      provider: "github",
      providerUserId: "12345",
    });

    const list = await agent.get("/api/v1/me/identities");
    expect(list.status).toBe(200);
    expect(list.body.identities).toEqual([
      expect.objectContaining({ provider: "github" }),
    ]);

    const res = await agent.delete("/api/v1/me/identities/github");
    expect(res.status).toBe(200);
    expect(fakePrisma.tables.authIdentity).toHaveLength(0);
  });

  it("keeps the last remaining sign-in method for passwordless users", async () => {
    const agent = await signedInAgent();
    fakePrisma.tables.user[0]!.passwordHash = null;
    fakePrisma.seed("authIdentity", {
      id: "ident_only",
      userId: fakePrisma.tables.user[0]!.id,
      provider: "google",
      providerUserId: "999",
    });

    const res = await agent.delete("/api/v1/me/identities/google");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LAST_AUTH_METHOD");
    expect(fakePrisma.tables.authIdentity).toHaveLength(1);
  });
});
