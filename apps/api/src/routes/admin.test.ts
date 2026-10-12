import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { resetRateLimits } from "../lib/rate-limit.js";
import { fakePrisma } from "../test/fake-prisma.js";

const app = createApp();

beforeEach(() => {
  fakePrisma.reset();
  resetRateLimits();
});

function seedUser(id: string, role = "USER", overrides: Record<string, unknown> = {}) {
  return fakePrisma.seed("user", {
    id,
    email: `${id}@example.com`,
    passwordHash: "x",
    displayName: id,
    role,
    ...overrides,
  });
}

function seedSession(id: string, userId: string, opts: { stepUp?: boolean } = {}) {
  const existing = fakePrisma.tables.session.findIndex((s) => s.id === id);
  if (existing >= 0) fakePrisma.tables.session.splice(existing, 1);
  fakePrisma.seed("session", {
    id,
    userId,
    refreshTokenHash: `hash-${id}`,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    stepUpAt: opts.stepUp ? new Date() : null,
    revokedAt: null,
  });
}

/** A signed-in client, optionally with a fresh step-up window. */
function client(userId: string, opts: { stepUp?: boolean } = {}) {
  const sessionId = `sess_${userId}`;
  seedSession(sessionId, userId, opts);
  const cookie = `gh_session=${sessionId}`;
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) => request(app).post(path).set("Cookie", cookie),
    patch: (path: string) => request(app).patch(path).set("Cookie", cookie),
    delete: (path: string) => request(app).delete(path).set("Cookie", cookie),
  };
}

function seedAdmin(opts: { stepUp?: boolean } = {}) {
  return client("admin1", opts);
}

beforeEach(() => {
  fakePrisma.seed("pedal", {
    id: "pedal_helix",
    brand: "Line 6",
    model: "Helix",
    slug: "line6-helix",
    validationMode: "DEEP_JSON",
    extensions: [".hlx"],
  });
  seedUser("regular1");
  seedUser("admin1", "ADMIN");
});

describe("admin access control (FR-7)", () => {
  it("401s anonymous callers", async () => {
    const res = await request(app).get("/api/v1/admin/stats");
    expect(res.status).toBe(401);
  });

  it("403s non-administrators with a stable code", async () => {
    const res = await client("regular1").get("/api/v1/admin/stats");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_REQUIRED");
  });

  it("allows administrators", async () => {
    const res = await seedAdmin().get("/api/v1/admin/stats");
    expect(res.status).toBe(200);
  });

  it("reports a suspended administrator as ACCOUNT_BANNED", async () => {
    seedUser("suspended_admin", "ADMIN", { bannedAt: new Date() });
    const res = await client("suspended_admin").get("/api/v1/admin/stats");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BANNED");
  });

  it("reports a suspended non-admin as banned rather than unauthorized", async () => {
    seedUser("suspended_user", "USER", { bannedAt: new Date() });
    const res = await client("suspended_user").get("/api/v1/admin/stats");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BANNED");
  });
});

describe("FR-7.1 pedal catalog CRUD", () => {
  it("lists every pedal including disabled ones with published preset counts", async () => {
    fakePrisma.seed("pedal", {
      id: "pedal_off",
      brand: "Boss",
      model: "GT-1000",
      slug: "boss-gt-1000",
      validationMode: "SHALLOW",
      extensions: [".tsl"],
      enabled: false,
    });
    fakePrisma.seed("preset", {
      id: "p1",
      userId: "regular1",
      pedalId: "pedal_helix",
      section: "GENERAL",
      title: "T",
      firmwareVersion: "3.7",
      status: "PUBLISHED",
    });
    const res = await seedAdmin().get("/api/v1/admin/pedals");
    expect(res.status).toBe(200);
    expect(res.body.pedals).toHaveLength(2);
    const helix = res.body.pedals.find((p: { id: string }) => p.id === "pedal_helix");
    const off = res.body.pedals.find((p: { id: string }) => p.id === "pedal_off");
    expect(helix.presetCount).toBe(1);
    expect(off.enabled).toBe(false);
  });

  it("creates a pedal, deriving the slug and applying defaults", async () => {
    const res = await seedAdmin().post("/api/v1/admin/pedals").send({
      brand: "Neural DSP",
      model: "Quad Cortex",
      validationMode: "CLOUD_LINK",
      extensions: [],
      aliases: ["QC"],
    });
    expect(res.status).toBe(201);
    expect(res.body.pedal.slug).toBe("neural-dsp-quad-cortex");
    expect(res.body.pedal.maxPresetBytes).toBe(1048576);
    expect(res.body.pedal.enabled).toBe(true);
    expect(fakePrisma.tables.auditLog.some((a) => a.action === "admin.pedal.create")).toBe(true);
  });

  it("rejects a duplicate slug with 409", async () => {
    const agent = seedAdmin();
    const payload = { brand: "Boss", model: "GT-1000", validationMode: "SHALLOW" };
    expect((await agent.post("/api/v1/admin/pedals").send(payload)).status).toBe(201);
    const res = await agent.post("/api/v1/admin/pedals").send(payload);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PEDAL_SLUG_TAKEN");
  });

  it("rejects malformed extensions with a validation error", async () => {
    const res = await seedAdmin().post("/api/v1/admin/pedals").send({
      brand: "Boss",
      model: "GT-1000",
      validationMode: "SHALLOW",
      extensions: ["tsl"],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("updates a pedal and regenerates the slug", async () => {
    const res = await seedAdmin().patch("/api/v1/admin/pedals/pedal_helix").send({
      model: "Helix Floor",
      enabled: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.pedal.slug).toBe("line-6-helix-floor");
    expect(res.body.pedal.enabled).toBe(false);
  });

  it("404s when updating an unknown pedal", async () => {
    const res = await seedAdmin().patch("/api/v1/admin/pedals/nope").send({ enabled: false });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PEDAL_NOT_FOUND");
  });

  it("409s when an update collides with another pedal's slug", async () => {
    fakePrisma.seed("pedal", {
      id: "pedal_gt",
      brand: "Boss",
      model: "GT-1000",
      slug: "boss-gt-1000",
      validationMode: "SHALLOW",
      extensions: [".tsl"],
    });
    const res = await seedAdmin().patch("/api/v1/admin/pedals/pedal_helix").send({
      brand: "Boss",
      model: "GT-1000",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PEDAL_SLUG_TAKEN");
  });
});

describe("FR-7.2 moderation queue", () => {
  function seedQueue() {
    seedUser("reporter1");
    seedUser("owner1");
    fakePrisma.seed("preset", {
      id: "preset1",
      userId: "owner1",
      pedalId: "pedal_helix",
      section: "GENERAL",
      title: "Sus preset",
      firmwareVersion: "3.7",
      status: "PUBLISHED",
    });
    fakePrisma.seed("comment", {
      id: "comment1",
      presetId: "preset1",
      userId: "owner1",
      bodyMd: "mean words",
      bodyHtml: "<p>mean words</p>",
    });
    fakePrisma.seed("report", {
      id: "rep_preset",
      reporterId: "reporter1",
      targetType: "PRESET",
      targetId: "preset1",
      reason: "spam spam spam",
      status: "OPEN",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    fakePrisma.seed("report", {
      id: "rep_comment",
      reporterId: "reporter1",
      targetType: "COMMENT",
      targetId: "comment1",
      reason: "abusive words here",
      status: "OPEN",
      createdAt: new Date("2026-02-02T00:00:00Z"),
    });
    fakePrisma.seed("report", {
      id: "rep_done",
      reporterId: "reporter1",
      targetType: "PRESET",
      targetId: "preset1",
      reason: "already handled",
      status: "DISMISSED",
      createdAt: new Date("2026-02-03T00:00:00Z"),
    });
  }

  it("lists open reports newest-first with enriched targets and counts", async () => {
    seedQueue();
    const res = await seedAdmin().get("/api/v1/admin/reports");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.reports[0].id).toBe("rep_comment");
    expect(res.body.reports[0].target).toMatchObject({
      type: "comment",
      excerpt: "mean words",
      owner: { id: "owner1" },
      preset: { id: "preset1", title: "Sus preset" },
    });
    const presetReport = res.body.reports.find((r: { id: string }) => r.id === "rep_preset");
    expect(presetReport.target).toMatchObject({
      type: "preset",
      title: "Sus preset",
      status: "published",
      owner: { id: "owner1" },
    });
    expect(res.body.counts).toEqual({ open: 2, resolved: 0, dismissed: 1 });
  });

  it("filters by status and paginates", async () => {
    seedQueue();
    const res = await seedAdmin().get("/api/v1/admin/reports?status=dismissed&page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.reports[0].id).toBe("rep_done");
    expect(res.body.reports[0].status).toBe("dismissed");
  });

  it("dismisses a report without touching content (step-up fresh)", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_preset/resolve")
      .send({ action: "dismiss", note: "not a violation" });
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("dismissed");
    const preset = fakePrisma.tables.preset.find((p) => p.id === "preset1");
    expect(preset?.status).toBe("PUBLISHED");
  });

  it("hides a reported preset and marks the report resolved", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_preset/resolve")
      .send({ action: "hide", note: "off-topic" });
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("resolved");
    const preset = fakePrisma.tables.preset.find((p) => p.id === "preset1");
    expect(preset?.status).toBe("HIDDEN");
    expect(preset?.statusReason).toBe("off-topic");
    expect(fakePrisma.tables.auditLog.some((a) => a.action === "admin.report.resolve")).toBe(true);
  });

  it("removes a reported comment", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_comment/resolve")
      .send({ action: "remove" });
    expect(res.status).toBe(200);
    expect(fakePrisma.tables.comment.find((c) => c.id === "comment1")).toBeUndefined();
  });

  it("requires step-up before acting", async () => {
    seedQueue();
    const res = await seedAdmin().post("/api/v1/admin/reports/rep_preset/resolve").send({
      action: "hide",
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("STEP_UP_REQUIRED");
    expect(fakePrisma.tables.preset.find((p) => p.id === "preset1")?.status).toBe("PUBLISHED");
  });

  it("409s when the report was already handled", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_done/resolve")
      .send({ action: "dismiss" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPORT_ALREADY_HANDLED");
  });

  it("404s for an unknown report or a vanished target", async () => {
    seedQueue();
    const agent = seedAdmin({ stepUp: true });
    expect((await agent.post("/api/v1/admin/reports/nope/resolve").send({ action: "dismiss" })).status).toBe(404);
    fakePrisma.tables.preset.length = 0;
    const gone = await agent.post("/api/v1/admin/reports/rep_preset/resolve").send({ action: "hide" });
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe("REPORT_TARGET_NOT_FOUND");
  });

  it("marks listed reports whose target has vanished as missing", async () => {
    seedQueue();
    fakePrisma.seed("report", {
      id: "rep_gone",
      reporterId: "reporter1",
      targetType: "PRESET",
      targetId: "ghost",
      reason: "already gone",
      status: "OPEN",
      createdAt: new Date("2026-02-04T00:00:00Z"),
    });
    const res = await seedAdmin().get("/api/v1/admin/reports");
    const vanished = res.body.reports.find((r: { id: string }) => r.id === "rep_gone");
    expect(vanished.target).toEqual({ type: "preset", id: "ghost", missing: true });
  });

  it("rejects an unknown resolve action", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_preset/resolve")
      .send({ action: "nuke" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(fakePrisma.tables.preset.find((p) => p.id === "preset1")?.status).toBe("PUBLISHED");
  });

  it("removes a reported preset outright", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_preset/resolve")
      .send({ action: "remove" });
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("resolved");
    expect(fakePrisma.tables.preset.find((p) => p.id === "preset1")).toBeUndefined();
  });

  it("hides a reported comment by soft-deleting it", async () => {
    seedQueue();
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/reports/rep_comment/resolve")
      .send({ action: "hide" });
    expect(res.status).toBe(200);
    expect(fakePrisma.tables.comment.find((c) => c.id === "comment1")?.deletedAt).toBeInstanceOf(Date);
  });
});

describe("FR-7.2 user ban / unban", () => {
  it("hard-bans a user and revokes their sessions", async () => {
    seedUser("victim");
    seedSession("victim-sess", "victim");
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/users/victim/ban")
      .send({ type: "hard", reason: "fraud" });
    expect(res.status).toBe(200);
    const victim = fakePrisma.tables.user.find((u) => u.id === "victim");
    expect(victim?.banType).toBe("HARD");
    expect(victim?.bannedAt).toBeInstanceOf(Date);
    expect(fakePrisma.tables.session.find((s) => s.id === "victim-sess")?.revokedAt).toBeInstanceOf(Date);
  });

  it("shadow-bans a user and hides their published presets", async () => {
    seedUser("victim");
    fakePrisma.seed("preset", {
      id: "vp",
      userId: "victim",
      pedalId: "pedal_helix",
      section: "GENERAL",
      title: "V",
      firmwareVersion: "3.7",
      status: "PUBLISHED",
    });
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/users/victim/ban")
      .send({ type: "shadow", reason: "spam" });
    expect(res.status).toBe(200);
    expect(fakePrisma.tables.preset.find((p) => p.id === "vp")?.status).toBe("HIDDEN");
  });

  it("unbans a user and clears the ban fields", async () => {
    seedUser("victim", "USER", { bannedAt: new Date(), banType: "SHADOW", banReason: "x" });
    const res = await seedAdmin({ stepUp: true }).post("/api/v1/admin/users/victim/unban").send({});
    expect(res.status).toBe(200);
    const victim = fakePrisma.tables.user.find((u) => u.id === "victim");
    expect(victim?.bannedAt).toBeNull();
    expect(victim?.banType).toBeNull();
  });

  it("guards against re-banning, unbanning the un-banned, self and other admins", async () => {
    seedUser("victim", "USER", { bannedAt: new Date() });
    seedUser("admin2", "ADMIN");
    const agent = seedAdmin({ stepUp: true });
    expect((await agent.post("/api/v1/admin/users/victim/ban").send({ type: "hard", reason: "x" })).status).toBe(409);
    expect((await agent.post("/api/v1/admin/users/regular1/unban").send({})).status).toBe(409);
    const self = await agent.post("/api/v1/admin/users/admin1/ban").send({ type: "hard", reason: "x" });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe("CANNOT_BAN_SELF");
    const admin = await agent.post("/api/v1/admin/users/admin2/ban").send({ type: "hard", reason: "x" });
    expect(admin.status).toBe(403);
    expect(admin.body.code).toBe("CANNOT_BAN_ADMIN");
  });

  it("requires step-up to ban", async () => {
    seedUser("victim");
    const res = await seedAdmin().post("/api/v1/admin/users/victim/ban").send({ type: "hard", reason: "x" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("STEP_UP_REQUIRED");
  });

  it("404s when banning or unbanning an unknown user", async () => {
    const agent = seedAdmin({ stepUp: true });
    const ban = await agent.post("/api/v1/admin/users/ghost/ban").send({ type: "hard", reason: "x" });
    expect(ban.status).toBe(404);
    expect(ban.body.code).toBe("USER_NOT_FOUND");
    const unban = await agent.post("/api/v1/admin/users/ghost/unban").send({});
    expect(unban.status).toBe(404);
    expect(unban.body.code).toBe("USER_NOT_FOUND");
  });

  it("validates the ban payload", async () => {
    seedUser("victim2");
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/users/victim2/ban")
      .send({ type: "nuke", reason: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(fakePrisma.tables.user.find((u) => u.id === "victim2")?.bannedAt).toBeNull();
  });
});

describe("FR-7.3 stats dashboard", () => {
  it("summarises signups, uploads, downloads, storage and engagement", async () => {
    seedUser("newbie");
    fakePrisma.seed("preset", {
      id: "p1",
      userId: "regular1",
      pedalId: "pedal_helix",
      section: "GENERAL",
      title: "A",
      firmwareVersion: "3.7",
      status: "PUBLISHED",
      downloadCount: 5,
    });
    fakePrisma.seed("preset", {
      id: "p2",
      userId: "regular1",
      pedalId: "pedal_helix",
      section: "GENERAL",
      title: "B",
      firmwareVersion: "3.7",
      status: "DRAFT",
    });
    fakePrisma.seed("presetFile", { id: "f1", presetId: "p1", presetVersion: 1, role: "PRIMARY", storageKey: "k", contentHash: "h", size: 2048, ext: ".hlx" });
    fakePrisma.seed("vote", { userId: "regular1", presetId: "p1", value: 1 });
    fakePrisma.seed("comment", { id: "c1", presetId: "p1", userId: "regular1", bodyMd: "nice", bodyHtml: "<p>nice</p>" });

    const res = await seedAdmin().get("/api/v1/admin/stats");
    expect(res.status).toBe(200);
    expect(res.body.presets).toMatchObject({ total: 2, published: 1, draft: 1 });
    expect(res.body.downloads.total).toBe(5);
    expect(res.body.storage).toEqual({ bytes: 2048, files: 1 });
    expect(res.body.engagement).toMatchObject({ comments: 1, votes: 1, openReports: 0 });
    const helix = res.body.perPedal.find((p: { pedalId: string }) => p.pedalId === "pedal_helix");
    expect(helix).toMatchObject({ presets: 1, downloads: 5 });
    expect(res.body.users.total).toBeGreaterThanOrEqual(3);
    expect(res.body.recentSignups.length).toBeGreaterThan(0);
  });
});

describe("FR-7.4 tag governance", () => {
  it("lists tags with preset counts and blacklist state", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("presetTag", { presetId: "presetX", tagId: "t1" });
    const res = await seedAdmin().get("/api/v1/admin/tags");
    expect(res.status).toBe(200);
    const crunch = res.body.tags.find((t: { slug: string }) => t.slug === "crunch");
    expect(crunch).toMatchObject({ presetCount: 1, blacklisted: false });
  });

  it("creates a tag and rejects duplicates / invalid slugs", async () => {
    const agent = seedAdmin();
    expect((await agent.post("/api/v1/admin/tags").send({ slug: "shoegaze", label: "Shoegaze" })).status).toBe(201);
    const dup = await agent.post("/api/v1/admin/tags").send({ slug: "shoegaze", label: "Other" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("TAG_SLUG_TAKEN");
    expect((await agent.post("/api/v1/admin/tags").send({ slug: "Bad Slug", label: "x" })).status).toBe(400);
  });

  it("renames a tag and rejects slug conflicts", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("tag", { id: "t2", slug: "lead", label: "Lead" });
    const agent = seedAdmin();
    const ok = await agent.patch("/api/v1/admin/tags/t1").send({ label: "Crunchy" });
    expect(ok.status).toBe(200);
    expect(ok.body.tag.label).toBe("Crunchy");
    const conflict = await agent.patch("/api/v1/admin/tags/t1").send({ slug: "lead" });
    expect(conflict.status).toBe(409);
  });

  it("blacklisting detaches the tag from every preset (step-up)", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("presetTag", { presetId: "p1", tagId: "t1" });
    fakePrisma.seed("presetTag", { presetId: "p2", tagId: "t1" });

    const blocked = await seedAdmin().patch("/api/v1/admin/tags/t1").send({ blacklisted: true });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("STEP_UP_REQUIRED");

    const res = await seedAdmin({ stepUp: true })
      .patch("/api/v1/admin/tags/t1")
      .send({ blacklisted: true });
    expect(res.status).toBe(200);
    expect(res.body.tag.blacklisted).toBe(true);
    expect(res.body.detached).toBe(2);
    expect(fakePrisma.tables.presetTag.filter((l) => l.tagId === "t1")).toHaveLength(0);
  });

  it("merges duplicate tags, moving links and deleting the source", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("tag", { id: "t2", slug: "high-gain", label: "High Gain" });
    fakePrisma.seed("presetTag", { presetId: "p1", tagId: "t1" });
    fakePrisma.seed("presetTag", { presetId: "p2", tagId: "t1" });
    fakePrisma.seed("presetTag", { presetId: "p2", tagId: "t2" }); // already on target — must dedupe

    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/tags/t1/merge")
      .send({ targetTagId: "t2" });
    expect(res.status).toBe(200);
    expect(res.body.merged.moved).toBe(1);
    expect(fakePrisma.tables.tag.find((t) => t.id === "t1")).toBeUndefined();
    expect(fakePrisma.tables.presetTag.filter((l) => l.tagId === "t2")).toHaveLength(2);
    expect(fakePrisma.tables.presetTag.filter((l) => l.tagId === "t1")).toHaveLength(0);
  });

  it("rejects merging a tag into itself", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    const res = await seedAdmin({ stepUp: true })
      .post("/api/v1/admin/tags/t1/merge")
      .send({ targetTagId: "t1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TAG_MERGE_SELF");
  });

  it("404s when updating an unknown tag", async () => {
    const res = await seedAdmin().patch("/api/v1/admin/tags/ghost").send({ label: "x" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TAG_NOT_FOUND");
  });

  it("404s when merging an unknown source or target tag", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    const agent = seedAdmin({ stepUp: true });
    const source = await agent.post("/api/v1/admin/tags/ghost/merge").send({ targetTagId: "t1" });
    expect(source.status).toBe(404);
    expect(source.body.code).toBe("TAG_NOT_FOUND");
    const target = await agent.post("/api/v1/admin/tags/t1/merge").send({ targetTagId: "ghost" });
    expect(target.status).toBe(404);
    expect(target.body.code).toBe("TAG_TARGET_NOT_FOUND");
  });

  it("re-flagging an already-blacklisted tag needs no step-up", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch", blacklisted: true });
    const res = await seedAdmin().patch("/api/v1/admin/tags/t1").send({ blacklisted: true });
    expect(res.status).toBe(200);
    expect(res.body.tag.blacklisted).toBe(true);
    expect(res.body.detached).toBe(0);
  });

  it("requires step-up for a first-time merge", async () => {
    fakePrisma.seed("tag", { id: "t1", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("tag", { id: "t2", slug: "lead", label: "Lead" });
    const res = await seedAdmin()
      .post("/api/v1/admin/tags/t1/merge")
      .send({ targetTagId: "t2" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("STEP_UP_REQUIRED");
    expect(fakePrisma.tables.tag.find((t) => t.id === "t1")).toBeTruthy();
  });
});
