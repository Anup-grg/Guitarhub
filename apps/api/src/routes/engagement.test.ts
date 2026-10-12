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

function seedUser(id: string, displayName: string, overrides: Record<string, unknown> = {}) {
  return fakePrisma.seed("user", {
    id,
    email: `${id}@example.com`,
    passwordHash: "x",
    displayName,
    ...overrides,
  });
}

function seedPublished(overrides: Record<string, unknown> = {}) {
  return fakePrisma.seed("preset", {
    id: `preset_${Math.random().toString(36).slice(2, 10)}`,
    userId: "user_alice",
    pedalId: "pedal_line6",
    section: "GENERAL",
    title: "Crunch Box",
    descriptionMd: "old school rock tones",
    firmwareVersion: "3.70",
    kind: "FILE",
    status: "PUBLISHED",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });
}

/** Registers a fresh account and rolls its createdAt back so it can comment. */
async function register(displayName = "Voter"): Promise<{
  agent: ReturnType<typeof request.agent>;
  userId: string;
}> {
  const email = `u${Math.random().toString(36).slice(2, 10)}@example.com`;
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: "s3cure-guitar-passphrase",
    displayName,
    tosVersion: "1.0",
    acceptTerms: true,
    acceptGuidelines: true,
  });
  expect(res.status).toBe(201);
  const row = fakePrisma.tables.user.find((u) => u.email === email);
  if (row) row.createdAt = new Date(Date.now() - 60 * 60 * 1000);
  return { agent, userId: String(res.body.user.id) };
}

beforeEach(() => {
  fakePrisma.seed("pedal", {
    id: "pedal_line6",
    brand: "Line 6",
    model: "HX Stomp",
    slug: "line6-hx-stomp",
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
  });
  seedUser("user_alice", "Alice", { verified: true });
});

describe("PUT /api/v1/presets/:id/vote", () => {
  it("401s when signed out", async () => {
    const preset = seedPublished();
    const res = await request(app).put(`/api/v1/presets/${preset.id as string}/vote`).send({ value: 1 });
    expect(res.status).toBe(401);
  });

  it("records, updates, flips and clears a vote and refreshes hot rank", async () => {
    const preset = seedPublished();
    const { agent, userId } = await register();
    const url = `/api/v1/presets/${preset.id as string}/vote`;

    const up = await agent.put(url).send({ value: 1 });
    expect(up.status).toBe(200);
    expect(up.body.counts).toEqual({ up: 1, down: 0, score: 1 });
    expect(up.body.userVote).toBe(1);
    expect((fakePrisma.tables.vote[0] as { id?: string }).id).toBeUndefined();

    const flip = await agent.put(url).send({ value: -1 });
    expect(flip.body.counts).toEqual({ up: 0, down: 1, score: -1 });
    expect(fakePrisma.tables.vote).toHaveLength(1);

    const clear = await agent.put(url).send({ value: 0 });
    expect(clear.body.counts).toEqual({ up: 0, down: 0, score: 0 });
    expect(fakePrisma.tables.vote).toHaveLength(0);

    const row = fakePrisma.tables.preset.find((p) => p.id === preset.id);
    expect(typeof row?.hotRank).toBe("number");
    expect(userId).toBeTruthy();
  });

  it("rejects voting on your own preset", async () => {
    const { agent, userId } = await register();
    const preset = seedPublished({ userId });
    const res = await agent.put(`/api/v1/presets/${preset.id as string}/vote`).send({ value: 1 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("VOTE_OWN_PRESET");
  });

  it("404s for unpublished or unknown presets", async () => {
    const draft = seedPublished({ status: "DRAFT" });
    const { agent } = await register();
    const draftRes = await agent.put(`/api/v1/presets/${draft.id as string}/vote`).send({ value: 1 });
    expect(draftRes.status).toBe(404);
    const missing = await agent.put("/api/v1/presets/nope/vote").send({ value: 1 });
    expect(missing.status).toBe(404);
  });

  it("exposes the viewer's vote on the detail endpoint", async () => {
    const preset = seedPublished();
    const { agent } = await register();
    await agent.put(`/api/v1/presets/${preset.id as string}/vote`).send({ value: -1 });

    const detail = await agent.get(`/api/v1/presets/${preset.id as string}`);
    expect(detail.status).toBe(200);
    expect(detail.body.preset.userVote).toBe(-1);
    expect(detail.body.preset.counts.down).toBe(1);
  });
});

describe("comments", () => {
  it("401s when signed out", async () => {
    const preset = seedPublished();
    const res = await request(app)
      .post(`/api/v1/presets/${preset.id as string}/comments`)
      .send({ bodyMd: "hi" });
    expect(res.status).toBe(401);
  });

  it("creates and lists a top-level comment with rendered markdown", async () => {
    const preset = seedPublished();
    const { agent } = await register("Commenter");
    const url = `/api/v1/presets/${preset.id as string}/comments`;

    const created = await agent.post(url).send({ bodyMd: "**killer** tone `+3 dB`" });
    expect(created.status).toBe(201);
    expect(created.body.comment.author.displayName).toBe("Commenter");
    expect(created.body.comment.bodyHtml).toContain("<strong>killer</strong>");
    expect(created.body.comment.deleted).toBe(false);

    const list = await agent.get(url);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.comments[0].id).toBe(created.body.comment.id);
    expect(list.body.comments[0].replies).toEqual([]);
  });

  it("supports one level of replies and rejects deeper nesting", async () => {
    const preset = seedPublished();
    const { agent } = await register();
    const url = `/api/v1/presets/${preset.id as string}/comments`;

    const top = await agent.post(url).send({ bodyMd: "top level" });
    const reply = await agent.post(url).send({ bodyMd: "a reply", parentId: top.body.comment.id });
    expect(reply.status).toBe(201);
    expect(reply.body.comment.parentId).toBe(top.body.comment.id);

    const list = await agent.get(url);
    expect(list.body.comments).toHaveLength(1);
    expect(list.body.comments[0].replies).toHaveLength(1);

    const deep = await agent.post(url).send({ bodyMd: "too deep", parentId: reply.body.comment.id });
    expect(deep.status).toBe(400);
    expect(deep.body.code).toBe("COMMENT_PARENT_INVALID");
  });

  it("enforces the link limit", async () => {
    const preset = seedPublished();
    const { agent } = await register();
    const bodyMd = Array.from({ length: 5 }, (_, i) => `[l${i}](https://example.com/${i})`).join(" ");
    const res = await agent.post(`/api/v1/presets/${preset.id as string}/comments`).send({ bodyMd });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COMMENT_TOO_MANY_LINKS");
  });

  it("blocks brand-new accounts", async () => {
    const preset = seedPublished();
    const email = `fresh${Math.random().toString(36).slice(2, 8)}@example.com`;
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send({
      email,
      password: "s3cure-guitar-passphrase",
      displayName: "Fresh",
      tosVersion: "1.0",
      acceptTerms: true,
      acceptGuidelines: true,
    });
    const res = await agent
      .post(`/api/v1/presets/${preset.id as string}/comments`)
      .send({ bodyMd: "hello world" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_TOO_NEW");
  });

  it("404s when commenting on an unpublished preset", async () => {
    const draft = seedPublished({ status: "DRAFT" });
    const { agent } = await register();
    const res = await agent
      .post(`/api/v1/presets/${draft.id as string}/comments`)
      .send({ bodyMd: "sneaky" });
    expect(res.status).toBe(404);
  });

  it("edits your own comment within the window", async () => {
    const preset = seedPublished();
    const { agent, userId } = await register();
    const comment = fakePrisma.seed("comment", {
      id: "c_edit",
      presetId: preset.id,
      userId,
      parentId: null,
      bodyMd: "original",
      bodyHtml: "<p>original</p>",
      createdAt: new Date(),
    });

    const res = await agent.patch(`/api/v1/comments/${comment.id as string}`).send({ bodyMd: "edited *now*" });
    expect(res.status).toBe(200);
    expect(res.body.comment.bodyHtml).toContain("<em>now</em>");
    expect(res.body.comment.editedAt).not.toBeNull();
  });

  it("rejects edits after the window and by non-authors", async () => {
    const preset = seedPublished();
    const { agent } = await register();
    const old = fakePrisma.seed("comment", {
      id: "c_old",
      presetId: preset.id,
      userId: "user_alice",
      parentId: null,
      bodyMd: "old",
      bodyHtml: "<p>old</p>",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const other = await agent.patch(`/api/v1/comments/${old.id as string}`).send({ bodyMd: "hijack now" });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("COMMENT_NOT_OWNED");

    const mine = fakePrisma.seed("comment", {
      id: "c_stale",
      presetId: preset.id,
      userId: String((await agent.get("/api/v1/me")).body.user.id),
      parentId: null,
      bodyMd: "stale",
      bodyHtml: "<p>stale</p>",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const late = await agent.patch(`/api/v1/comments/${mine.id as string}`).send({ bodyMd: "too late now" });
    expect(late.status).toBe(403);
    expect(late.body.code).toBe("COMMENT_EDIT_WINDOW");
  });

  it("soft-deletes as a tombstone and hides the body", async () => {
    const preset = seedPublished();
    const { agent, userId } = await register();
    const comment = fakePrisma.seed("comment", {
      id: "c_del",
      presetId: preset.id,
      userId,
      parentId: null,
      bodyMd: "bye",
      bodyHtml: "<p>bye</p>",
      createdAt: new Date(),
    });

    const del = await agent.delete(`/api/v1/comments/${comment.id as string}`);
    expect(del.status).toBe(204);

    const list = await agent.get(`/api/v1/presets/${preset.id as string}/comments`);
    const row = list.body.comments.find((c: { id: string }) => c.id === comment.id);
    expect(row.deleted).toBe(true);
    expect(row.bodyMd).toBeNull();
    expect(row.author).toBeNull();
  });
});

describe("POST /api/v1/reports", () => {
  it("401s when signed out", async () => {
    const res = await request(app).post("/api/v1/reports").send({
      targetType: "preset",
      targetId: "preset_x",
      reason: "this is spam content",
    });
    expect(res.status).toBe(401);
  });

  it("files a report and dedupes open reports", async () => {
    const preset = seedPublished();
    const { agent } = await register();
    const payload = { targetType: "preset", targetId: preset.id, reason: "copied from another uploader" };

    const first = await agent.post("/api/v1/reports").send(payload);
    expect(first.status).toBe(201);
    expect(first.body.report.status).toBe("open");

    const dup = await agent.post("/api/v1/reports").send(payload);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("REPORT_DUPLICATE");
  });

  it("404s unknown targets and validates the reason length", async () => {
    const { agent } = await register();
    const missing = await agent
      .post("/api/v1/reports")
      .send({ targetType: "comment", targetId: "nope", reason: "this is a fine reason" });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("REPORT_TARGET_NOT_FOUND");

    const short = await agent
      .post("/api/v1/reports")
      .send({ targetType: "preset", targetId: "x", reason: "spam" });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("VALIDATION_ERROR");
  });
});
