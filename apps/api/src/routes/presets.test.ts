import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { resetRateLimits } from "../lib/rate-limit.js";
import { outbox } from "../lib/mailer.js";
import { getStorage } from "../lib/storage.js";
import { fakePrisma } from "../test/fake-prisma.js";

const app = createApp();

beforeEach(() => {
  fakePrisma.reset();
  resetRateLimits();
  outbox.length = 0;
});

async function signIn() {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({
    email: `u${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: "s3cure-guitar-passphrase",
    displayName: "Uploader",
    tosVersion: "1.0",
    acceptTerms: true,
    acceptGuidelines: true,
  });
  expect(res.status).toBe(201);
  return agent;
}

function seedPedal(overrides: Record<string, unknown> = {}) {
  return fakePrisma.seed("pedal", {
    id: "pedal_line6",
    brand: "Line 6",
    model: "HX Stomp",
    slug: "line6-hx-stomp",
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    ...overrides,
  });
}

function hlxBytes(name = "Crunch Box"): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema: "L6Preset",
      version: 6,
      meta: {},
      data: { name, device: "HX Stomp", firmwareVersion: "3.70" },
    }),
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** upload-url → PUT the bytes → returns the storage key. */
async function upload(
  agent: Awaited<ReturnType<typeof signIn>>,
  pedalSlug: string,
  filename: string,
  bytes: Buffer,
  role: "primary" | "ir" = "primary",
): Promise<string> {
  const requested = await agent.post("/api/v1/presets/upload-url").send({
    pedalSlug,
    filename,
    size: bytes.length,
    role,
  });
  expect(requested.status).toBe(201);
  const path = new URL(requested.body.url).pathname;
  const put = await agent
    .put(path)
    .set("Content-Type", "application/octet-stream")
    .send(bytes);
  expect(put.status).toBe(201);
  return requested.body.key as string;
}

function baseMeta(overrides: Record<string, unknown> = {}) {
  return {
    pedalSlug: "line6-hx-stomp",
    section: "general",
    title: "Crunch Box",
    firmwareVersion: "3.70",
    tags: ["crunch"],
    licenseAttested: true,
    ...overrides,
  };
}

describe("POST /api/v1/presets/upload-url", () => {
  it("401s when signed out", async () => {
    const res = await request(app)
      .post("/api/v1/presets/upload-url")
      .send({ pedalSlug: "line6-hx-stomp", filename: "a.hlx", size: 10 });
    expect(res.status).toBe(401);
  });

  it("returns a pre-signed PUT bound to a quarantine key", async () => {
    seedPedal();
    const agent = await signIn();
    const res = await agent.post("/api/v1/presets/upload-url").send({
      pedalSlug: "line6-hx-stomp",
      filename: "Crunch Box.hlx",
      size: 1024,
    });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^quarantine\//);
    expect(res.body.key).toContain("crunch_box.hlx");
    expect(res.body.url).toContain("/api/v1/storage/local/upload/");
    expect(res.body.maxBytes).toBe(1048576);
  });

  it("rejects extensions outside the pedal allowlist", async () => {
    seedPedal();
    const agent = await signIn();
    const res = await agent.post("/api/v1/presets/upload-url").send({
      pedalSlug: "line6-hx-stomp",
      filename: "malware.exe",
      size: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_EXTENSION_NOT_ALLOWED");
  });

  it("rejects payloads beyond the pedal size cap", async () => {
    seedPedal();
    const agent = await signIn();
    const res = await agent.post("/api/v1/presets/upload-url").send({
      pedalSlug: "line6-hx-stomp",
      filename: "big.hlx",
      size: 2 * 1024 * 1024,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_SIZE_EXCEEDED");
  });

  it("404s unknown pedals and refuses file uploads for Quad Cortex", async () => {
    seedPedal();
    fakePrisma.seed("pedal", {
      id: "pedal_qc",
      brand: "Neural DSP",
      model: "Quad Cortex",
      slug: "neural-quad-cortex",
      validationMode: "CLOUD_LINK",
      extensions: [],
    });
    const agent = await signIn();

    const unknown = await agent
      .post("/api/v1/presets/upload-url")
      .send({ pedalSlug: "nope", filename: "a.hlx", size: 10 });
    expect(unknown.status).toBe(404);

    const qc = await agent
      .post("/api/v1/presets/upload-url")
      .send({ pedalSlug: "neural-quad-cortex", filename: "a.hlx", size: 10 });
    expect(qc.status).toBe(400);
    expect(qc.body.code).toBe("CLOUD_LINK_REQUIRED");
  });

  it("rate limits after 30 requests per hour", async () => {
    seedPedal();
    const agent = await signIn();
    for (let i = 0; i < 30; i++) {
      const ok = await agent
        .post("/api/v1/presets/upload-url")
        .send({ pedalSlug: "line6-hx-stomp", filename: `f${i}.hlx`, size: 10 });
      expect(ok.status).toBe(201);
    }
    const limited = await agent
      .post("/api/v1/presets/upload-url")
      .send({ pedalSlug: "line6-hx-stomp", filename: "f31.hlx", size: 10 });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
  });
});

describe("POST /api/v1/presets/inspect", () => {
  it("validates the upload and extracts Line 6 metadata", async () => {
    seedPedal();
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "amb.hlx", hlxBytes("Ambient Wash"));

    const res = await agent.post("/api/v1/presets/inspect").send({
      pedalSlug: "line6-hx-stomp",
      key,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      contentHash: sha256(hlxBytes("Ambient Wash")),
      size: hlxBytes("Ambient Wash").length,
      kind: "file",
      duplicateOf: null,
    });
    expect(res.body.extracted).toMatchObject({
      title: "Ambient Wash",
      device: "HX Stomp",
      firmwareVersion: "3.70",
    });
  });

  it("rejects files that fail validation", async () => {
    seedPedal();
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "bad.hlx", Buffer.from("{nope"));

    const res = await agent.post("/api/v1/presets/inspect").send({
      pedalSlug: "line6-hx-stomp",
      key,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_JSON_INVALID");
  });

  it("403s keys owned by someone else and 404s unknown keys", async () => {
    seedPedal();
    const alice = await signIn();
    const bob = await signIn();
    const key = await upload(alice, "line6-hx-stomp", "a.hlx", hlxBytes());

    const stolen = await bob.post("/api/v1/presets/inspect").send({
      pedalSlug: "line6-hx-stomp",
      key,
    });
    expect(stolen.status).toBe(403);
    expect(stolen.body.code).toBe("UPLOAD_KEY_NOT_OWNED");

    const missing = await alice.post("/api/v1/presets/inspect").send({
      pedalSlug: "line6-hx-stomp",
      key: `quarantine/${key.split("/")[1]}/does-not-exist/a.hlx`,
    });
    expect(missing.status).toBe(404);
  });
});

describe("POST /api/v1/presets (finalize)", () => {
  it("publishes a validated preset and moves it out of quarantine", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const bytes = hlxBytes();
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", bytes);

    const res = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ files: [{ key, role: "primary" }] }));
    expect(res.status).toBe(201);

    const preset = res.body.preset;
    expect(preset).toMatchObject({
      title: "Crunch Box",
      status: "published",
      section: "general",
      kind: "file",
      firmwareVersion: "3.70",
      contentHash: sha256(bytes),
      fileSize: bytes.length,
      fileExt: "hlx",
      pedal: { slug: "line6-hx-stomp", brand: "Line 6", model: "HX Stomp" },
      user: { displayName: "Uploader" },
    });
    expect(preset.tags).toEqual([{ slug: "crunch", label: "Crunch" }]);
    expect(preset.files).toHaveLength(1);
    expect(preset.files[0]).toMatchObject({ role: "primary", ext: "hlx" });

    const row = fakePrisma.tables.preset[0]!;
    expect(row.storageKey).toBe(`presets/${preset.id}/v1/primary.hlx`);
    expect(await getStorage().get(String(row.storageKey))).not.toBeNull();
    expect(await getStorage().get(key)).toBeNull();

    expect(fakePrisma.tables.presetFile).toHaveLength(1);
    expect(fakePrisma.tables.presetTag).toHaveLength(1);
    expect(fakePrisma.tables.auditLog.find((r) => r.action === "preset.create")).toMatchObject({ action: "preset.create" });
  });

  it("saves drafts without publishing", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", hlxBytes());

    const res = await agent.post("/api/v1/presets").send(
      baseMeta({ status: "draft", files: [{ key, role: "primary" }] }),
    );
    expect(res.status).toBe(201);
    expect(res.body.preset.status).toBe("draft");
    expect(fakePrisma.tables.preset[0]!.status).toBe("DRAFT");
  });

  it("enforces section-specific metadata", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();

    const songsMissing = await agent.post("/api/v1/presets").send(
      baseMeta({
        section: "songs",
        title: "Cover",
        tags: [],
        files: [{ key: "quarantine/x/y/a.hlx", role: "primary" }],
      }),
    );
    expect(songsMissing.status).toBe(400);
    expect(songsMissing.body.code).toBe("VALIDATION_ERROR");

    const generalNoTags = await agent.post("/api/v1/presets").send(baseMeta({ tags: [] }));
    expect(generalNoTags.status).toBe(400);
  });

  it("accepts song metadata for the songs section", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_worship", slug: "worship", label: "Worship" });
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "song.hlx", hlxBytes());

    const res = await agent.post("/api/v1/presets").send(
      baseMeta({
        section: "songs",
        title: "Worship Pad",
        songTitle: "Amazing Grace",
        artist: "Trad.",
        tags: ["worship"],
        files: [{ key, role: "primary" }],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.preset).toMatchObject({
      section: "songs",
      songTitle: "Amazing Grace",
      artist: "Trad.",
    });
  });

  it("rejects unknown tags and more than five tags", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", hlxBytes());

    const unknown = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ tags: ["crunch", "not-a-tag"], files: [{ key, role: "primary" }] }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("TAG_UNKNOWN");

    const tooMany = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ tags: ["a", "b", "c", "d", "e", "f"] }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects tags that moderation has blacklisted (FR-7.4)", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_abuse", slug: "abuse", label: "Abuse", blacklisted: true });
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", hlxBytes());

    const res = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ tags: ["abuse"], files: [{ key, role: "primary" }] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TAG_BLACKLISTED");
  });

  it("requires the license attestation", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const res = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ licenseAttested: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects re-uploads of identical published content unless acknowledged", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const bytes = hlxBytes();
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", bytes);

    const first = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ files: [{ key, role: "primary" }] }));
    expect(first.status).toBe(201);

    const key2 = await upload(agent, "line6-hx-stomp", "crunch-copy.hlx", bytes);
    const duplicate = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ files: [{ key: key2, role: "primary" }] }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("DUPLICATE_CONTENT");

    const acked = await agent.post("/api/v1/presets").send(
      baseMeta({ files: [{ key: key2, role: "primary" }], forkAck: true }),
    );
    expect(acked.status).toBe(201);
    expect(fakePrisma.tables.preset).toHaveLength(2);
  });

  it("rejects a failed re-validation on finalize", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const key = await upload(agent, "line6-hx-stomp", "sneaky.hlx", Buffer.from("%PDF-1.4"));
    const res = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ files: [{ key, role: "primary" }] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_MAGIC_MISMATCH");
    expect(fakePrisma.tables.preset).toHaveLength(0);
  });

  it("refuses to finalize another user's upload", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const alice = await signIn();
    const bob = await signIn();
    const key = await upload(alice, "line6-hx-stomp", "a.hlx", hlxBytes());

    const res = await bob
      .post("/api/v1/presets")
      .send(baseMeta({ files: [{ key, role: "primary" }] }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UPLOAD_KEY_NOT_OWNED");
    expect(fakePrisma.tables.preset).toHaveLength(0);
  });

  it("publishes a Quad Cortex preset from a validated cloud link", async () => {
    fakePrisma.seed("pedal", {
      id: "pedal_qc",
      brand: "Neural DSP",
      model: "Quad Cortex",
      slug: "neural-quad-cortex",
      validationMode: "CLOUD_LINK",
      extensions: [],
    });
    fakePrisma.seed("tag", { id: "tag_lead", slug: "lead", label: "Lead" });
    const agent = await signIn();

    const res = await agent.post("/api/v1/presets").send({
      pedalSlug: "neural-quad-cortex",
      section: "general",
      title: "Cloud Lead",
      firmwareVersion: "CorOS 2.0.0",
      kind: "cloud_link",
      cloudUrl: "https://cloud.neuraldsp.com/presets/abc123",
      tags: ["lead"],
      licenseAttested: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.preset).toMatchObject({
      kind: "cloud_link",
      status: "published",
      cloudUrl: "https://cloud.neuraldsp.com/presets/abc123",
      contentHash: null,
      fileExt: null,
    });
    expect(fakePrisma.tables.presetFile).toHaveLength(0);
  });

  it("rejects unsafe or wrong-host cloud links", async () => {
    fakePrisma.seed("pedal", {
      id: "pedal_qc",
      brand: "Neural DSP",
      model: "Quad Cortex",
      slug: "neural-quad-cortex",
      validationMode: "CLOUD_LINK",
      extensions: [],
    });
    fakePrisma.seed("tag", { id: "tag_lead", slug: "lead", label: "Lead" });
    const agent = await signIn();

    for (const [cloudUrl, code] of [
      ["https://evil.example/p", "CLOUD_URL_HOST_NOT_ALLOWED"],
      ["http://cloud.neuraldsp.com/p", "CLOUD_URL_INVALID"],
      ["https://user@cloud.neuraldsp.com/p", "CLOUD_URL_INVALID"],
    ] as const) {
      const res = await agent.post("/api/v1/presets").send({
        pedalSlug: "neural-quad-cortex",
        section: "general",
        title: "Cloud Lead",
        firmwareVersion: "CorOS 2.0.0",
        kind: "cloud_link",
        cloudUrl,
        tags: ["lead"],
        licenseAttested: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
    }
    expect(fakePrisma.tables.preset).toHaveLength(0);
  });

  it("rejects cloud links for file pedals and files for Quad Cortex", async () => {
    seedPedal();
    fakePrisma.seed("pedal", {
      id: "pedal_qc",
      brand: "Neural DSP",
      model: "Quad Cortex",
      slug: "neural-quad-cortex",
      validationMode: "CLOUD_LINK",
      extensions: [],
    });
    fakePrisma.seed("tag", { id: "tag_lead", slug: "lead", label: "Lead" });
    const agent = await signIn();

    const wrongKind = await agent.post("/api/v1/presets").send({
      pedalSlug: "line6-hx-stomp",
      section: "general",
      title: "Nope",
      firmwareVersion: "3.70",
      kind: "cloud_link",
      cloudUrl: "https://cloud.neuraldsp.com/x",
      tags: ["lead"],
      licenseAttested: true,
    });
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.code).toBe("CLOUD_LINK_NOT_SUPPORTED");

    const key = await upload(agent, "line6-hx-stomp", "a.hlx", hlxBytes());
    const qcFile = await agent.post("/api/v1/presets").send({
      pedalSlug: "neural-quad-cortex",
      section: "general",
      title: "Nope",
      firmwareVersion: "CorOS 2.0.0",
      kind: "file",
      tags: ["lead"],
      licenseAttested: true,
      files: [{ key, role: "primary" }],
    });
    expect(qcFile.status).toBe(400);
    expect(qcFile.body.code).toBe("CLOUD_LINK_REQUIRED");
  });

  it("401s when signed out", async () => {
    const res = await request(app).post("/api/v1/presets").send(baseMeta());
    expect(res.status).toBe(401);
  });

  it("attaches companion IR files to the preset", async () => {
    seedPedal();
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const wav = Buffer.concat([
      Buffer.from("RIFF    WAVEfmt "),
      Buffer.alloc(64, 0),
    ]);
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", hlxBytes());
    const irKey = await upload(agent, "line6-hx-stomp", "greenback.wav", wav, "ir");

    const res = await agent.post("/api/v1/presets").send(
      baseMeta({
        usesThirdPartyIr: true,
        files: [
          { key, role: "primary" },
          { key: irKey, role: "ir" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.preset.files).toHaveLength(2);
    expect(res.body.preset.files.map((f: { role: string }) => f.role).sort()).toEqual([
      "ir",
      "primary",
    ]);
    const stored = fakePrisma.tables.presetFile.map((f) => f.storageKey);
    expect(stored.some((k) => String(k).includes("ir-1.wav"))).toBe(true);
    expect(await getStorage().get(irKey)).toBeNull();
  });
});

describe("GET /api/v1/presets (browse)", () => {
  function seedUser(id: string, displayName: string, verified = true) {
    return fakePrisma.seed("user", {
      id,
      email: `${id}@example.com`,
      passwordHash: "x",
      displayName,
      verified,
    });
  }

  function seedPublished(overrides: Record<string, unknown> = {}) {
    const preset = fakePrisma.seed("preset", {
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
    fakePrisma.seed("presetFile", {
      id: `${preset.id}_f1`,
      presetId: preset.id,
      presetVersion: 1,
      role: "PRIMARY",
      storageKey: `presets/${preset.id}/v1/primary.hlx`,
      contentHash: `hash-${preset.id}`,
      size: 128,
      mime: "application/octet-stream",
      ext: "hlx",
    });
    return FakeTable("preset", String(preset.id));
  }

  function tagPreset(presetId: string, slug: string, label: string): void {
    const tag = fakePrisma.seed("tag", { id: `tag_${slug}_${presetId}`, slug, label });
    fakePrisma.seed("presetTag", { presetId, tagId: tag.id });
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
    fakePrisma.seed("pedal", {
      id: "pedal_helix",
      brand: "Line 6",
      model: "Helix",
      slug: "line6-helix",
      validationMode: "DEEP_JSON",
      extensions: ["hlx"],
    });
    seedUser("user_alice", "Alice", true);
    seedUser("user_bob", "Bob", false);
  });

  it("lists only published presets with counts, tags and files", async () => {
    const p = seedPublished({ title: "Scooped", createdAt: new Date("2026-02-01T00:00:00Z") });
    seedPublished({ status: "DRAFT", title: "Secret WIP" });

    const res = await request(app).get("/api/v1/presets");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.presets[0]).toMatchObject({
      id: p.id,
      title: "Scooped",
      section: "general",
      status: "published",
      user: { displayName: "Alice", verified: true },
      pedal: { slug: "line6-hx-stomp", brand: "Line 6", model: "HX Stomp" },
      counts: { up: 0, down: 0, score: 0, comments: 0, downloads: 0, views: 0 },
    });
    expect(res.body.presets[0].files).toHaveLength(1);
    expect(res.body.presets[0].files[0]).toMatchObject({ role: "primary", ext: "hlx", size: 128 });
    expect(res.body.nextCursor).toBeNull();
  });

  it("filters by pedal, section, tag, usesIr and verified uploader", async () => {
    const a = seedPublished({ title: "Pedal A" });
    seedPublished({ title: "Pedal B", pedalId: "pedal_helix" });
    const c = seedPublished({ title: "Sectioned", section: "SONGS", songTitle: "Song", artist: "Artist" });
    tagPreset(a.id, "crunch", "Crunch");
    tagPreset(c.id, "crunch", "Crunch");

    const byPedal = await request(app).get("/api/v1/presets?pedal=line6-helix");
    expect(byPedal.body.total).toBe(1);
    expect(byPedal.body.presets[0].title).toBe("Pedal B");

    const bySection = await request(app).get("/api/v1/presets?section=songs");
    expect(bySection.body.total).toBe(1);
    expect(bySection.body.presets[0].title).toBe("Sectioned");

    const byTag = await request(app).get("/api/v1/presets?tag=crunch");
    expect(byTag.body.total).toBe(2);

    const byIr = await request(app).get("/api/v1/presets?usesIr=true");
    expect(byIr.body.total).toBe(0);
    expect(
      (await request(app).get("/api/v1/presets?usesIr=true&pedal=nope")).status,
    ).toBe(404);

    const verified = await request(app).get("/api/v1/presets?pedal=line6-hx-stomp&verified=true");
    expect(verified.body.presets.every((x: { user: { verified: boolean } }) => x.user.verified)).toBe(true);
  });

  it("searches across title, song, artist, tags and uploader", async () => {
    seedPublished({ title: "Maple Lead", descriptionMd: "smoky sustain" });
    seedPublished({ title: "Ambient Pad", songTitle: "Amazing Grace", artist: "Trad." });
    const tagged = seedPublished({ title: "Untagged title", createdAt: new Date("2026-03-01T00:00:00Z") });
    tagPreset(tagged.id, "shoegaze", "Shoegaze");
    const bob = seedPublished({ title: "From Bob", userId: "user_bob", createdAt: new Date("2026-04-01T00:00:00Z") });

    const byTitle = await request(app).get("/api/v1/presets?q=maple");
    expect(byTitle.body.total).toBe(1);
    expect(byTitle.body.presets[0].title).toBe("Maple Lead");

    const bySong = await request(app).get("/api/v1/presets?q=amazing");
    expect(bySong.body.total).toBe(1);

    const byTag = await request(app).get("/api/v1/presets?q=shoegaze");
    expect(byTag.body.total).toBe(1);

    const byUploader = await request(app).get("/api/v1/presets?q=bob");
    expect(byUploader.body.total).toBe(1);
    expect(byUploader.body.presets[0].id).toBe(bob.id);
  });

  it("sorts by hot, new, top, downloads and comments", async () => {
    const old = seedPublished({ title: "Old Poll", createdAt: new Date("2026-01-01T00:00:00Z") });
    const hotNew = seedPublished({ title: "New Hot", createdAt: new Date("2026-06-01T00:00:00Z") });
    const downloaded = seedPublished({
      title: "Most Downloaded",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      downloadCount: 50,
    });

    seedUser("user_v1", "Voter 1");
    seedUser("user_v2", "Voter 2");
    for (const voter of ["user_v1", "user_v2"]) {
      fakePrisma.seed("vote", { userId: voter, presetId: old.id, value: 1 });
      fakePrisma.seed("vote", { userId: voter, presetId: downloaded.id, value: -1 });
    }
    fakePrisma.seed("comment", {
      id: "comment_1",
      presetId: hotNew.id,
      userId: "user_alice",
      bodyMd: "sounds great",
    });

    const newest = await request(app).get("/api/v1/presets?sort=new");
    expect(newest.body.presets.map((x: { title: string }) => x.title)).toEqual([
      "New Hot",
      "Most Downloaded",
      "Old Poll",
    ]);

    const hot = await request(app).get("/api/v1/presets?sort=hot");
    expect(hot.body.presets[0].title).toBe("Old Poll"); // 2 upvotes rank above new-but-unvoted

    const top = await request(app).get("/api/v1/presets?sort=top");
    expect(top.body.presets[0].title).toBe("Old Poll");
    expect(top.body.presets[0].counts.score).toBe(2);

    const byDownloads = await request(app).get("/api/v1/presets?sort=downloads");
    expect(byDownloads.body.presets[0].title).toBe("Most Downloaded");

    const byComments = await request(app).get("/api/v1/presets?sort=comments");
    expect(byComments.body.presets[0].title).toBe("New Hot");
    expect(byComments.body.presets[0].counts.comments).toBe(1);
  });

  it("paginates with a cursor", async () => {
    for (let i = 1; i <= 5; i++) {
      seedPublished({
        title: `Preset ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, i)),
      });
    }
    const page1 = await request(app).get("/api/v1/presets?sort=new&limit=2");
    expect(page1.body.presets).toHaveLength(2);
    expect(page1.body.total).toBe(5);
    expect(page1.body.nextCursor).toBe(page1.body.presets[1].id);

    const page2 = await request(app).get(
      `/api/v1/presets?sort=new&limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    expect(page2.body.presets).toHaveLength(2);
    expect(page2.body.presets[0].id).not.toBe(page1.body.presets[0].id);
    expect(page2.body.nextCursor).toBe(page2.body.presets[1].id);

    const page3 = await request(app).get(
      `/api/v1/presets?sort=new&limit=2&cursor=${encodeURIComponent(page2.body.nextCursor)}`,
    );
    expect(page3.body.presets).toHaveLength(1);
    expect(page3.body.nextCursor).toBeNull();
  });

  it("rejects an invalid cursor", async () => {
    seedPublished();
    const res = await request(app).get("/api/v1/presets?cursor=nope");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CURSOR");
  });
});

describe("GET /api/v1/presets/:id (detail)", () => {
  beforeEach(() => {
    fakePrisma.seed("pedal", {
      id: "pedal_line6",
      brand: "Line 6",
      model: "HX Stomp",
      slug: "line6-hx-stomp",
      validationMode: "DEEP_JSON",
      extensions: ["hlx"],
      importInstructionsMd: "# Import\nPut it on your device.",
    });
  });

  function seedAlicePreset(overrides: Record<string, unknown> = {}) {
    fakePrisma.seed("user", {
      id: "user_alice",
      email: "alice@example.com",
      passwordHash: "x",
      displayName: "Alice",
      verified: true,
    });
    const preset = fakePrisma.seed("preset", {
      id: "preset_one",
      userId: "user_alice",
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "Crunch Box",
      descriptionMd: "old school rock tones",
      firmwareVersion: "3.70",
      kind: "FILE",
      status: "PUBLISHED",
      viewCount: 3,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    });
    fakePrisma.seed("presetFile", {
      id: "preset_one_f1",
      presetId: preset.id,
      presetVersion: 1,
      role: "PRIMARY",
      storageKey: "presets/preset_one/v1/primary.hlx",
      contentHash: "hash-1",
      size: 128,
      mime: "application/octet-stream",
      ext: "hlx",
    });
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("presetTag", { presetId: preset.id, tagId: "tag_crunch" });
    return preset;
  }

  it("returns full metadata including import instructions and uploader", async () => {
    seedAlicePreset();
    const res = await request(app).get("/api/v1/presets/preset_one");
    expect(res.status).toBe(200);
    expect(res.body.preset).toMatchObject({
      title: "Crunch Box",
      user: { id: "user_alice", displayName: "Alice", verified: true },
      tags: [{ slug: "crunch", label: "Crunch" }],
      pedal: {
        slug: "line6-hx-stomp",
        importInstructionsMd: "# Import\nPut it on your device.",
      },
      counts: { views: 4, downloads: 0, comments: 0, score: 0 },
      mine: false,
      firmwareWarning: null,
    });
    expect(FakeTable("preset", "preset_one").viewCount).toBe(4);
  });

  it("404s drafts for other users", async () => {
    seedAlicePreset({ status: "DRAFT" });

    const anon = await request(app).get("/api/v1/presets/preset_one");
    expect(anon.status).toBe(404);
    expect(anon.body.code).toBe("PRESET_NOT_FOUND");

    const agent = await signIn(); // a different user
    const other = await agent.get("/api/v1/presets/preset_one");
    expect(other.status).toBe(404);
  });

  it("lets the owner view their own draft", async () => {
    const agent = await signIn();
    const ownerId = String(fakePrisma.tables.user[fakePrisma.tables.user.length - 1]!.id);
    fakePrisma.seed("preset", {
      id: "preset_mine",
      userId: ownerId,
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "My WIP",
      firmwareVersion: "3.70",
      kind: "FILE",
      status: "DRAFT",
      viewCount: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const res = await agent.get("/api/v1/presets/preset_mine");
    expect(res.status).toBe(200);
    expect(res.body.preset).toMatchObject({ title: "My WIP", mine: true });
  });

  it("warns when the signed-in user's gear firmware differs", async () => {
    seedAlicePreset();
    const agent = await signIn();
    const me = await agent.get("/api/v1/me");
    fakePrisma.seed("userGear", {
      id: "gear_1",
      userId: me.body.user.id,
      pedalId: "pedal_line6",
      firmwareVersion: "3.50",
    });

    const res = await agent.get("/api/v1/presets/preset_one");
    expect(res.status).toBe(200);
    expect(res.body.preset.firmwareWarning).toContain("targets firmware 3.70");
    expect(res.body.preset.firmwareWarning).toContain("3.50");
  });
});

describe("GET /api/v1/presets/:id/download", () => {
  beforeEach(() => {
    fakePrisma.seed("pedal", {
      id: "pedal_line6",
      brand: "Line 6",
      model: "HX Stomp",
      slug: "line6-hx-stomp",
      validationMode: "DEEP_JSON",
      extensions: ["hlx"],
    });
  });

  it("redirects to the pre-signed file, streams it back and counts once per day", async () => {
    fakePrisma.seed("user", {
      id: "user_alice",
      email: "alice@example.com",
      passwordHash: "x",
      displayName: "Alice",
    });
    fakePrisma.seed("tag", { id: "tag_crunch", slug: "crunch", label: "Crunch" });
    const agent = await signIn();
    const bytes = hlxBytes();
    const key = await upload(agent, "line6-hx-stomp", "crunch.hlx", bytes);
    const created = await agent
      .post("/api/v1/presets")
      .send(baseMeta({ files: [{ key, role: "primary" }] }));
    expect(created.status).toBe(201);
    const id = created.body.preset.id;

    const dl = await agent.get(`/api/v1/presets/${id}/download`);
    expect(dl.status).toBe(302);
    expect(dl.headers.location).toContain("/api/v1/storage/local/download/");
    expect(dl.headers["cache-control"]).toBe("no-store");

    const path = new URL(String(dl.headers.location)).pathname;
    const stream = await request(app).get(path);
    expect(stream.status).toBe(200);
    expect(stream.headers["content-disposition"]).toContain('filename="crunch-box.hlx"');
    expect(stream.headers["content-type"]).toBe("application/octet-stream");
    expect(Buffer.from(stream.body).equals(bytes)).toBe(true);

    const hit = FakeTable("preset", id);
    expect(hit.downloadCount).toBe(1);
    expect(fakePrisma.tables.downloadEvent).toHaveLength(1);

    await agent.get(`/api/v1/presets/${id}/download`);
    expect(FakeTable("preset", id).downloadCount).toBe(2);
    expect(fakePrisma.tables.downloadEvent).toHaveLength(1); // same day, deduped
  });

  it("redirects cloud-link presets straight to Cortex Cloud", async () => {
    fakePrisma.seed("preset", {
      id: "preset_cloud",
      userId: "user_alice",
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "Cloud Lead",
      firmwareVersion: "CorOS 2.0.0",
      kind: "CLOUD_LINK",
      cloudUrl: "https://cloud.neuraldsp.com/presets/abc123",
      status: "PUBLISHED",
    });
    const res = await request(app).get("/api/v1/presets/preset_cloud/download");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://cloud.neuraldsp.com/presets/abc123");
    expect(FakeTable("preset", "preset_cloud").downloadCount).toBe(1);
  });

  it("404s drafts, unpublished and missing presets", async () => {
    fakePrisma.seed("preset", {
      id: "preset_draft",
      userId: "user_alice",
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "WIP",
      firmwareVersion: "3.70",
      kind: "FILE",
      status: "DRAFT",
    });
    expect((await request(app).get("/api/v1/presets/preset_draft/download")).status).toBe(404);
    expect((await request(app).get("/api/v1/presets/missing/download")).status).toBe(404);
  });

  it("rate limits anonymous downloads after 30 per hour", async () => {
    fakePrisma.seed("preset", {
      id: "preset_rl",
      userId: "user_alice",
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "Crunch",
      firmwareVersion: "3.70",
      kind: "FILE",
      status: "PUBLISHED",
    });
    fakePrisma.seed("presetFile", {
      id: "preset_rl_f1",
      presetId: "preset_rl",
      presetVersion: 1,
      role: "PRIMARY",
      storageKey: "presets/preset_rl/v1/primary.hlx",
      contentHash: "hash-rl",
      size: 12,
      mime: "application/octet-stream",
      ext: "hlx",
    });
    for (let i = 0; i < 30; i++) {
      const ok = await request(app).get("/api/v1/presets/preset_rl/download");
      expect(ok.status).toBe(302);
    }
    const limited = await request(app).get("/api/v1/presets/preset_rl/download");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("rate limits signed-in downloads after 100 per hour", async () => {
    fakePrisma.seed("preset", {
      id: "preset_rl_auth",
      userId: "user_alice",
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "Crunch",
      firmwareVersion: "3.70",
      kind: "FILE",
      status: "PUBLISHED",
    });
    fakePrisma.seed("presetFile", {
      id: "preset_rl_auth_f1",
      presetId: "preset_rl_auth",
      presetVersion: 1,
      role: "PRIMARY",
      storageKey: "presets/preset_rl_auth/v1/primary.hlx",
      contentHash: "hash-rl-auth",
      size: 12,
      mime: "application/octet-stream",
      ext: "hlx",
    });
    const agent = await signIn();
    for (let i = 0; i < 100; i++) {
      const ok = await agent.get("/api/v1/presets/preset_rl_auth/download");
      expect(ok.status).toBe(302);
    }
    const limited = await agent.get("/api/v1/presets/preset_rl_auth/download");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("records a signed-in download once per day under the user client key", async () => {
    fakePrisma.seed("preset", {
      id: "preset_rl_key",
      userId: "user_alice",
      pedalId: "pedal_line6",
      section: "GENERAL",
      title: "Crunch",
      firmwareVersion: "3.70",
      kind: "FILE",
      status: "PUBLISHED",
    });
    fakePrisma.seed("presetFile", {
      id: "preset_rl_key_f1",
      presetId: "preset_rl_key",
      presetVersion: 1,
      role: "PRIMARY",
      storageKey: "presets/preset_rl_key/v1/primary.hlx",
      contentHash: "hash-rl-key",
      size: 12,
      mime: "application/octet-stream",
      ext: "hlx",
    });
    const agent = await signIn();
    const userId = String(
      fakePrisma.tables.user[fakePrisma.tables.user.length - 1]!.id,
    );

    expect((await agent.get("/api/v1/presets/preset_rl_key/download")).status).toBe(302);
    expect((await agent.get("/api/v1/presets/preset_rl_key/download")).status).toBe(302);

    const events = fakePrisma.tables.downloadEvent.filter(
      (e) => e.presetId === "preset_rl_key",
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.clientKey).toBe(`user:${userId}`);
    expect(FakeTable("preset", "preset_rl_key").downloadCount).toBe(2);
  });
});

interface TestPresetRow {
  id: string;
  viewCount: number;
  downloadCount: number;
}

function FakeTable(
  model: "preset" | "presetFile" | "vote" | "comment" | "downloadEvent",
  id: string,
): TestPresetRow {
  const row = fakePrisma.tables[model].find((r) => r.id === id);
  if (!row) throw new Error(`no ${model} ${id} in fake tables`);
  return row as unknown as TestPresetRow;
}
