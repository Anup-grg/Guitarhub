/**
 * GuitarHub end-to-end integration test - Phases 1-6 against the real
 * PostgreSQL dev database. No mocks: every request goes over HTTP to a
 * running API instance (directly, or through the Next.js proxy when
 * BASE_URL points at the web origin).
 *
 * Rate limits are in-memory per process, so restart the API between runs
 * (register is 5/h per IP and this suite spends that budget).
 *
 * Usage:
 *   # API must be running, e.g. from apps/api:
 *   $env:APP_URL="http://localhost:4000"; npm run dev
 *   npm run test:integration
 *
 *   # Through the web proxy (API with APP_URL=http://localhost:3000, plus web):
 *   BASE_URL=http://localhost:3000/api/v1 npm run test:integration
 *
 *   --keep   skip DB / local-storage cleanup of this run's data
 */
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const KEEP = process.argv.includes("--keep");
const STORAGE_DIR = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? ".local-objects");
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Json = Record<string, unknown>;
const prisma = new PrismaClient();

// ---------------------------------------------------------------- harness --

let passed = 0;
let failed = 0;
const failures: string[] = [];

function section(name: string): void {
  console.log(`\n== ${name} ==`);
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  FAIL ${name} - ${msg}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function obj(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    throw new Error(`expected ${what} to be an object, got ${got}`);
  }
  return value as Json;
}

function list(value: unknown, what: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`expected ${what} to be an array`);
  return value as Json[];
}

function code(reply: Reply): string {
  return typeof reply.body?.code === "string" ? reply.body.code : "<no code>";
}

// ------------------------------------------------------------------- http ---

class Jar {
  private cookies = new Map<string, string>();

  apply(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  adopt(other: Jar): void {
    for (const [k, v] of other.cookies) this.cookies.set(k, v);
  }
}

interface Reply {
  status: number;
  headers: Headers;
  body: Json | null;
  text: string;
  location: string | null;
}

interface CallOpts {
  jar?: Jar;
  body?: unknown;
  raw?: Buffer | string;
  headers?: Record<string, string>;
}

async function call(method: string, target: string, opts: CallOpts = {}): Promise<Reply> {
  const url = /^https?:\/\//.test(target) ? target : `${BASE_URL}${target}`;
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.jar) {
    const cookie = opts.jar.header();
    if (cookie) headers.Cookie = cookie;
  }
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  } else if (opts.raw !== undefined) {
    body = opts.raw;
    headers["Content-Type"] ??= "application/octet-stream";
  }
  const res = await fetch(url, { method, headers, body, redirect: "manual" });
  opts.jar?.apply(res);
  const text = await res.text();
  let parsed: Json | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = null;
    }
  }
  return {
    status: res.status,
    headers: res.headers,
    body: parsed,
    text,
    location: res.headers.get("location"),
  };
}

async function waitForHealth(timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// ------------------------------------------------------------------ data ---

function hlx(name: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema: "L6Preset",
      version: 6,
      meta: {},
      data: { name, device: "HX Stomp", firmwareVersion: "3.70" },
    }),
  );
}

function sha256hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "preset"
  );
}

function registerBody(email: string, password: string): Json {
  return {
    email,
    password,
    displayName: "Integration Tester",
    tosVersion: "2026-09-01",
    acceptTerms: true,
    acceptGuidelines: true,
  };
}

async function uploadBytes(
  jar: Jar,
  pedalSlug: string,
  filename: string,
  bytes: Buffer,
): Promise<string> {
  const req = await call("POST", "/presets/upload-url", {
    jar,
    body: { pedalSlug, filename, size: bytes.length, role: "primary" },
  });
  assert(req.status === 201, `upload-url -> ${req.status} ${code(req)}`);
  const url = String(req.body?.url ?? "");
  assert(url.length > 0, "upload-url returned no url");
  const rawHeaders = obj(req.body?.headers ?? {}, "headers");
  const putHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (typeof v === "string") putHeaders[k] = v;
  }
  const put = await call("PUT", url, { raw: bytes, headers: putHeaders });
  assert(put.status === 201, `PUT -> ${put.status} ${code(put)}`);
  const key = String(req.body?.key ?? "");
  assert(key.length > 0, "upload-url returned no key");
  return key;
}

/** Sessions are created with a fresh step-up, so age it out before testing the gate. */
async function expireStepUp(jar: Jar): Promise<void> {
  const id = jar.header().split("gh_session=")[1]?.split(";")[0] ?? "";
  assert(id.length > 0, "no session cookie on the jar");
  await prisma.session.update({
    where: { id },
    data: { stepUpAt: new Date(Date.now() - 6 * 60_000) },
  });
}

// ------------------------------------------------------------------ state ---

const createdEmails: string[] = [];
const owner = new Jar();
let stompId = "";
let stompMaxBytes = 1_048_576;
let tagA = "";
let tagB = "";
let mainTitle = "";
let cloudTitle = "";
let draftTitle = "";
let mainBytes = Buffer.alloc(0);
let mainHash = "";
let mainId = "";
let cloudId = "";
let draftId = "";
let cloudUrl = "";
let draftKey = "";
let mainUploadUrl = "";

const member = new Jar();
const moderator = new Jar();
const memberEmail = `it-member-${RUN}@example.com`;
const moderatorEmail = `it-mod-${RUN}@example.com`;
const memberPassword = `IntegrationMember#${RUN}`;
const moderatorPassword = `IntegrationModerator#${RUN}`;
let memberId = "";
let moderatorId = "";
let commentId = "";
let replyId = "";
let mainReportId = "";
let cloudReportId = "";
let tagSlugA = "";
let tagSlugB = "";
let tagIdA = "";
let tagIdB = "";
const createdPedalIds: string[] = [];

// ------------------------------------------------------------------ flow ---

async function main(): Promise<number> {
  console.log(`GuitarHub integration - ${BASE_URL} (run ${RUN})`);
  if (!(await waitForHealth())) {
    console.error(`API not reachable at ${BASE_URL} - start it first (see header of this file).`);
    return 2;
  }

  // ------------------------------------------------------------ Phase 1 ---
  section("Phase 1 - Foundation (health, catalog, tags)");

  await check("health: API ok and DB up", async () => {
    const r = await call("GET", "/health");
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body?.status === "ok", `status=${String(r.body?.status)}`);
    assert(r.body?.db === "up", `db=${String(r.body?.db)}`);
  });

  await check("catalog: seeded pedals with Line 6 available", async () => {
    const r = await call("GET", "/pedals");
    assert(r.status === 200, `status ${r.status}`);
    const pedals = list(r.body?.pedals, "pedals");
    assert(pedals.length >= 28, `expected >= 28 pedals, got ${pedals.length}`);
    const stomp = pedals.find((p) => p.slug === "line6-hx-stomp");
    assert(stomp, "line6-hx-stomp missing from catalog");
    assert(typeof stomp.id === "string" && stomp.id.length > 0, "stomp.id missing");
    stompId = String(stomp.id);
    stompMaxBytes = Number(stomp.maxPresetBytes ?? 1_048_576);
    assert(Number.isFinite(stompMaxBytes) && stompMaxBytes > 0, "maxPresetBytes missing");
  });

  await check("pedal detail: import instructions and validation mode", async () => {
    const r = await call("GET", "/pedals/line6-hx-stomp");
    assert(r.status === 200, `status ${r.status}`);
    const pedal = obj(r.body?.pedal, "pedal");
    assert(pedal.validationMode === "DEEP_JSON", `validationMode=${String(pedal.validationMode)}`);
    assert(
      Array.isArray(pedal.extensions) && pedal.extensions.includes("hlx"),
      "extensions missing hlx",
    );
    assert(
      typeof pedal.importInstructionsMd === "string" && pedal.importInstructionsMd.length >= 10,
      "importInstructionsMd missing",
    );
    assert(typeof pedal.presetCount === "number", "presetCount missing");
  });

  await check("tags: seeded and sorted by label", async () => {
    const r = await call("GET", "/tags");
    assert(r.status === 200, `status ${r.status}`);
    const tags = list(r.body?.tags, "tags");
    assert(tags.length >= 15, `expected >= 15 tags, got ${tags.length}`);
    const labels = tags.map((t) => String(t.label));
    const sorted = [...labels].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en"));
    assert(JSON.stringify(labels) === JSON.stringify(sorted), "tags not sorted by label");
    tagA = String(tags[0]?.slug ?? "");
    tagB = String(tags[1]?.slug ?? "");
    assert(tagA && tagB && tagA !== tagB, "need two distinct tag slugs");
  });

  // ------------------------------------------------------------ Phase 2 ---
  section("Phase 2 - Auth and identity");

  const email = `it-${RUN}@example.com`;
  const password = `Integration#Passw0rd-${RUN}`;
  const password2 = `Integration#Passw0rd2-${RUN}`;

  await check("register: creates account and session", async () => {
    const r = await call("POST", "/auth/register", {
      jar: owner,
      body: registerBody(email, password),
    });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    const user = obj(r.body?.user, "user");
    assert(typeof user.id === "string" && user.id.length > 0, "user.id missing");
    createdEmails.push(email);
    assert(owner.header().includes("gh_session="), "no session cookie set");
  });

  await check("register: duplicate email rejected 409", async () => {
    const r = await call("POST", "/auth/register", { body: registerBody(email, password) });
    assert(r.status === 409, `status ${r.status}`);
    assert(code(r) === "EMAIL_TAKEN", `code ${code(r)}`);
  });

  await check("register: weak password rejected 400", async () => {
    const r = await call("POST", "/auth/register", {
      body: registerBody(`it-w-${RUN}@example.com`, "short"),
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(code(r) === "VALIDATION_ERROR", `code ${code(r)}`);
  });

  await check("GET /me returns the account", async () => {
    const r = await call("GET", "/me", { jar: owner });
    assert(r.status === 200, `status ${r.status}`);
    const user = obj(r.body?.user, "user");
    assert(user.email === email, `email=${String(user.email)}`);
    assert(user.displayName === "Integration Tester", `displayName=${String(user.displayName)}`);
  });

  await check("PATCH /me persists profile and pedal gear", async () => {
    const r = await call("PATCH", "/me", {
      jar: owner,
      body: {
        displayName: "Integration Tester",
        gear: [{ pedalId: stompId, firmwareVersion: "3.50" }],
      },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const gear = list(r.body?.gear, "gear");
    assert(gear.length === 1, `gear length ${gear.length}`);
    assert(String(gear[0]?.pedalId) === stompId, "gear pedalId mismatch");
    assert(String(gear[0]?.firmwareVersion) === "3.50", "gear firmwareVersion mismatch");
  });

  await check("sessions: current session listed", async () => {
    const r = await call("GET", "/me/sessions", { jar: owner });
    assert(r.status === 200, `status ${r.status}`);
    const sessions = list(r.body?.sessions, "sessions");
    assert(sessions.length >= 1, "no sessions returned");
    assert(
      sessions.some((s) => s.current === true),
      "current session not flagged",
    );
  });

  await check("logout ends the session", async () => {
    const out = await call("POST", "/auth/logout", { jar: owner });
    assert(out.status === 200, `logout status ${out.status}`);
    const me = await call("GET", "/me", { jar: owner });
    assert(me.status === 401, `GET /me after logout -> ${me.status}`);
  });

  await check("login: wrong password rejected", async () => {
    const r = await call("POST", "/auth/login", { body: { email, password: "WrongPassword#123" } });
    assert(r.status === 401, `status ${r.status}`);
  });

  const loginJar = new Jar();
  await check("login: correct password issues session", async () => {
    const r = await call("POST", "/auth/login", { jar: loginJar, body: { email, password } });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    assert(loginJar.header().includes("gh_session="), "no session cookie");
    const me = await call("GET", "/me", { jar: loginJar });
    assert(me.status === 200, `GET /me -> ${me.status}`);
  });

  await check("password change rotates credentials", async () => {
    const change = await call("POST", "/auth/password/change", {
      jar: loginJar,
      body: { currentPassword: password, newPassword: password2 },
    });
    assert(change.status < 300, `password change -> ${change.status} ${code(change)}`);
    const oldLogin = await call("POST", "/auth/login", { body: { email, password } });
    assert(oldLogin.status === 401, `old password still accepted (${oldLogin.status})`);
    const fresh = new Jar();
    const newLogin = await call("POST", "/auth/login", {
      jar: fresh,
      body: { email, password: password2 },
    });
    assert(newLogin.status === 200, `new password login -> ${newLogin.status} ${code(newLogin)}`);
    const me = await call("GET", "/me", { jar: fresh });
    assert(me.status === 200, `GET /me after re-login -> ${me.status}`);
    owner.adopt(fresh);
  });

  if ((await call("GET", "/me", { jar: owner })).status !== 200) {
    const rebuild = new Jar();
    const r = await call("POST", "/auth/login", {
      jar: rebuild,
      body: { email, password: password2 },
    });
    if (r.status === 200) owner.adopt(rebuild);
  }

  // ------------------------------------------------------------ Phase 3 ---
  section("Phase 3 - Upload pipeline (presign, inspect, publish)");

  mainTitle = `Zephyr Tune ${RUN}`;
  cloudTitle = `Cloud Smoke ${RUN}`;
  draftTitle = `Draft Smoke ${RUN}`;
  mainBytes = hlx(mainTitle);
  mainHash = sha256hex(mainBytes);
  cloudUrl = `https://cloud.neuraldsp.com/presets/it-${RUN}`;

  let mainKey = "";
  await check("upload-url: issues presigned PUT for Line 6 .hlx", async () => {
    const r = await call("POST", "/presets/upload-url", {
      jar: owner,
      body: {
        pedalSlug: "line6-hx-stomp",
        filename: `zephyr-${RUN}.hlx`,
        size: mainBytes.length,
        role: "primary",
      },
    });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    const key = String(r.body?.key ?? "");
    assert(key.startsWith("quarantine/") && key.includes("zephyr-"), `unexpected key ${key}`);
    const url = String(r.body?.url ?? "");
    assert(url.includes("/storage/local/upload/"), `unexpected upload url ${url}`);
    mainKey = key;
    mainUploadUrl = url;
  });

  await check("upload: bytes accepted by local store", async () => {
    assert(mainUploadUrl, "no presigned URL from previous check");
    const r = await call("PUT", mainUploadUrl, { raw: mainBytes });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    assert(r.body?.ok === true, "expected {ok:true}");
  });

  await check("inspect: sha256 and Line 6 metadata extracted", async () => {
    const r = await call("POST", "/presets/inspect", {
      jar: owner,
      body: { pedalSlug: "line6-hx-stomp", key: mainKey },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    assert(r.body?.contentHash === mainHash, `hash ${String(r.body?.contentHash)} != ${mainHash}`);
    assert(Number(r.body?.size) === mainBytes.length, `size ${String(r.body?.size)}`);
    const extracted = obj(r.body?.extracted, "extracted");
    assert(JSON.stringify(extracted).includes("HX Stomp"), "device not extracted");
    assert(r.body?.duplicateOf === null, "unexpected duplicateOf");
  });

  const publishMain: Json = {
    pedalSlug: "line6-hx-stomp",
    section: "songs",
    title: mainTitle,
    descriptionMd: `Integration smoke ${RUN}`,
    songTitle: "Zephyr",
    artist: "The Testers",
    firmwareVersion: "3.70",
    kind: "file",
    files: [{ key: mainKey, role: "primary" }],
    tags: [tagA],
    licenseAttested: true,
  };

  await check("publish: creates a published preset", async () => {
    const r = await call("POST", "/presets", { jar: owner, body: publishMain });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    const preset = obj(r.body?.preset, "preset");
    mainId = String(preset.id);
    assert(preset.status === "published", `status=${String(preset.status)}`);
    assert(preset.section === "songs", `section=${String(preset.section)}`);
    assert(preset.kind === "file", `kind=${String(preset.kind)}`);
    assert(obj(preset.pedal, "pedal").slug === "line6-hx-stomp", "pedal slug mismatch");
    assert(preset.contentHash === mainHash, "contentHash mismatch");
  });

  await check("publish: duplicate content rejected without forkAck", async () => {
    const key = await uploadBytes(owner, "line6-hx-stomp", `zephyr-dup-${RUN}.hlx`, mainBytes);
    const r = await call("POST", "/presets", {
      jar: owner,
      body: { ...publishMain, files: [{ key, role: "primary" }] },
    });
    assert(r.status === 409, `status ${r.status}`);
    assert(code(r) === "DUPLICATE_CONTENT", `code ${code(r)}`);
  });

  await check("upload-url: disallowed extension rejected 400", async () => {
    const r = await call("POST", "/presets/upload-url", {
      jar: owner,
      body: { pedalSlug: "line6-hx-stomp", filename: "evil.exe", size: 100, role: "primary" },
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(code(r) === "FILE_EXTENSION_NOT_ALLOWED", `code ${code(r)}`);
  });

  await check("upload-url: oversize file rejected 400", async () => {
    const r = await call("POST", "/presets/upload-url", {
      jar: owner,
      body: {
        pedalSlug: "line6-hx-stomp",
        filename: "huge.hlx",
        size: stompMaxBytes + 1,
        role: "primary",
      },
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(code(r) === "FILE_SIZE_EXCEEDED", `code ${code(r)}`);
  });

  await check("inspect: non-preset garbage rejected 400", async () => {
    const garbage = Buffer.from("definitely not a valid preset file");
    const key = await uploadBytes(owner, "line6-hx-stomp", `junk-${RUN}.hlx`, garbage);
    const r = await call("POST", "/presets/inspect", {
      jar: owner,
      body: { pedalSlug: "line6-hx-stomp", key },
    });
    assert(r.status === 400, `status ${r.status}`);
  });

  await check("cloud pedals reject file uploads", async () => {
    const r = await call("POST", "/presets/upload-url", {
      jar: owner,
      body: {
        pedalSlug: "neural-quad-cortex",
        filename: `qc-${RUN}.blkx`,
        size: 100,
        role: "primary",
      },
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(code(r) === "CLOUD_LINK_REQUIRED", `code ${code(r)}`);
  });

  const cloudBody: Json = {
    pedalSlug: "neural-quad-cortex",
    section: "general",
    title: cloudTitle,
    descriptionMd: `Integration cloud ${RUN}`,
    firmwareVersion: "CorOS 2.0.0",
    kind: "cloud_link",
    tags: [tagB],
    licenseAttested: true,
  };

  await check("cloud link: foreign host rejected 400", async () => {
    const r = await call("POST", "/presets", {
      jar: owner,
      body: { ...cloudBody, cloudUrl: "https://evil.example.com/presets/x" },
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(String(r.body?.code ?? "").startsWith("CLOUD_URL"), `code ${code(r)}`);
  });

  await check("cloud link: valid Cortex Cloud preset published", async () => {
    const r = await call("POST", "/presets", { jar: owner, body: { ...cloudBody, cloudUrl } });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    const preset = obj(r.body?.preset, "preset");
    cloudId = String(preset.id);
    assert(preset.kind === "cloud_link", `kind=${String(preset.kind)}`);
    assert(preset.status === "published", `status=${String(preset.status)}`);
    assert(preset.cloudUrl === cloudUrl, `cloudUrl=${String(preset.cloudUrl)}`);
    assert(preset.contentHash === null, "cloud preset should have no contentHash");
  });

  let draftUploaded = false;
  await check("publish: unknown tag rejected before write", async () => {
    const bytes = hlx(draftTitle);
    draftKey = await uploadBytes(owner, "line6-hx-stomp", `draft-${RUN}.hlx`, bytes);
    draftUploaded = true;
    const r = await call("POST", "/presets", {
      jar: owner,
      body: {
        pedalSlug: "line6-hx-stomp",
        section: "general",
        title: draftTitle,
        descriptionMd: `Integration draft ${RUN}`,
        firmwareVersion: "3.70",
        kind: "file",
        files: [{ key: draftKey, role: "primary" }],
        tags: [`it-${RUN}`],
        licenseAttested: true,
      },
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(code(r) === "TAG_UNKNOWN", `code ${code(r)}`);
  });

  await check("draft: saves with status draft", async () => {
    assert(draftUploaded && draftKey, "no draft upload from previous check");
    const r = await call("POST", "/presets", {
      jar: owner,
      body: {
        pedalSlug: "line6-hx-stomp",
        section: "general",
        title: draftTitle,
        descriptionMd: `Integration draft ${RUN}`,
        firmwareVersion: "3.70",
        kind: "file",
        files: [{ key: draftKey, role: "primary" }],
        tags: [tagA],
        licenseAttested: true,
        status: "draft",
      },
    });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    const preset = obj(r.body?.preset, "preset");
    draftId = String(preset.id);
    assert(preset.status === "draft", `status=${String(preset.status)}`);
  });

  // ------------------------------------------------------------ Phase 4 ---
  section("Phase 4 - Browse, search, download");

  await check("list: published preset findable anonymously by title", async () => {
    const r = await call("GET", `/presets?q=${encodeURIComponent(mainTitle)}&limit=5`);
    assert(r.status === 200, `status ${r.status}`);
    assert(Number(r.body?.total) === 1, `total=${String(r.body?.total)}`);
    const rows = list(r.body?.presets, "presets");
    assert(String(rows[0]?.id) === mainId, "wrong preset returned");
    assert(rows[0]?.status === "published", `status=${String(rows[0]?.status)}`);
  });

  await check("list: draft hidden from listings", async () => {
    const r = await call("GET", `/presets?q=${encodeURIComponent(draftTitle)}&limit=5`);
    assert(r.status === 200, `status ${r.status}`);
    assert(Number(r.body?.total) === 0, `draft leaked into list (total=${String(r.body?.total)})`);
  });

  await check("filter: by pedal", async () => {
    const structural = await call("GET", "/presets?pedal=line6-hx-stomp&limit=50");
    assert(structural.status === 200, `status ${structural.status}`);
    const rows = list(structural.body?.presets, "presets");
    assert(
      rows.every((p) => obj(p.pedal, "pedal").slug === "line6-hx-stomp"),
      "foreign pedal in results",
    );
    const pinned = await call(
      "GET",
      `/presets?pedal=line6-hx-stomp&q=${encodeURIComponent(mainTitle)}&limit=5`,
    );
    assert(Number(pinned.body?.total) === 1, "title+pinned pedal filter found nothing");
    const other = await call(
      "GET",
      `/presets?pedal=neural-quad-cortex&q=${encodeURIComponent(cloudTitle)}&limit=5`,
    );
    assert(Number(other.body?.total) === 1, "cloud preset not found under QC pedal filter");
  });

  await check("filter: by section", async () => {
    const songsMain = await call(
      "GET",
      `/presets?section=songs&q=${encodeURIComponent(mainTitle)}`,
    );
    assert(Number(songsMain.body?.total) === 1, "songs preset not in songs section");
    const songsCloud = await call(
      "GET",
      `/presets?section=songs&q=${encodeURIComponent(cloudTitle)}`,
    );
    assert(Number(songsCloud.body?.total) === 0, "general preset leaked into songs section");
    const generalCloud = await call(
      "GET",
      `/presets?section=general&q=${encodeURIComponent(cloudTitle)}`,
    );
    assert(Number(generalCloud.body?.total) === 1, "general preset not in general section");
  });

  await check("filter: by tag", async () => {
    const tagged = await call("GET", `/presets?tag=${tagA}&q=${encodeURIComponent(mainTitle)}`);
    assert(Number(tagged.body?.total) === 1, "tagged preset not found by its tag");
    const wrongTag = await call("GET", `/presets?tag=${tagB}&q=${encodeURIComponent(mainTitle)}`);
    assert(Number(wrongTag.body?.total) === 0, "preset matched a tag it does not carry");
    const cloudTagged = await call(
      "GET",
      `/presets?tag=${tagB}&q=${encodeURIComponent(cloudTitle)}`,
    );
    assert(Number(cloudTagged.body?.total) === 1, "cloud preset not found by its tag");
  });

  await check("filter: usesIr", async () => {
    const noIr = await call("GET", `/presets?usesIr=false&q=${encodeURIComponent(mainTitle)}`);
    assert(Number(noIr.body?.total) === 1, "preset without IR not found");
    const withIr = await call("GET", `/presets?usesIr=true&q=${encodeURIComponent(mainTitle)}`);
    assert(Number(withIr.body?.total) === 0, "IR filter leaked an IR-less preset");
  });

  await check("sort: new puts the latest published preset first", async () => {
    const r = await call("GET", "/presets?sort=new&limit=1");
    assert(r.status === 200, `status ${r.status}`);
    const rows = list(r.body?.presets, "presets");
    assert(
      String(rows[0]?.id) === cloudId,
      `expected newest=${cloudId}, got ${String(rows[0]?.id)}`,
    );
    const wide = await call("GET", "/presets?sort=new&limit=50");
    const ids = list(wide.body?.presets, "presets").map((p) => String(p.id));
    assert(
      ids.includes(mainId) && ids.includes(cloudId),
      "published presets missing from sort=new",
    );
    assert(!ids.includes(draftId), "draft appeared in sort=new");
  });

  await check("sort: hot/top/downloads/comments respond 200", async () => {
    for (const sort of ["hot", "top", "downloads", "comments"]) {
      const r = await call("GET", `/presets?sort=${sort}&limit=5`);
      assert(r.status === 200, `sort=${sort} -> ${r.status}`);
    }
  });

  await check("pagination: cursor pages are disjoint", async () => {
    const p1 = await call("GET", "/presets?sort=new&limit=1");
    const rows1 = list(p1.body?.presets, "presets");
    const cursor = p1.body?.nextCursor;
    assert(rows1.length === 1, "page 1 not full");
    assert(typeof cursor === "string" && cursor.length > 0, "nextCursor missing");
    const p2 = await call("GET", `/presets?sort=new&limit=1&cursor=${encodeURIComponent(cursor)}`);
    const rows2 = list(p2.body?.presets, "presets");
    assert(rows2.length === 1, "page 2 not full");
    assert(String(rows2[0]?.id) !== String(rows1[0]?.id), "page 2 overlapped page 1");
  });

  await check("pagination: invalid cursor rejected 400", async () => {
    const r = await call("GET", "/presets?sort=new&limit=1&cursor=not-a-real-cursor");
    assert(r.status === 400, `status ${r.status}`);
    assert(code(r) === "INVALID_CURSOR", `code ${code(r)}`);
  });

  await check("detail: full metadata and view counter increments", async () => {
    const first = await call("GET", `/presets/${mainId}`);
    assert(first.status === 200, `status ${first.status}`);
    const preset = obj(first.body?.preset, "preset");
    assert(preset.songTitle === "Zephyr", "songTitle missing");
    assert(preset.artist === "The Testers", "artist missing");
    const pedal = obj(preset.pedal, "pedal");
    assert(
      typeof pedal.importInstructionsMd === "string" && pedal.importInstructionsMd.length >= 10,
      "importInstructionsMd missing",
    );
    const views1 = Number(obj(preset.counts, "counts").views);
    const second = await call("GET", `/presets/${mainId}`);
    const views2 = Number(obj(obj(second.body?.preset, "preset").counts, "counts").views);
    assert(views2 === views1 + 1, `views ${views1} -> ${views2} (expected +1)`);
  });

  await check("detail: draft 404 anonymously, visible to owner", async () => {
    const anon = await call("GET", `/presets/${draftId}`);
    assert(anon.status === 404, `anon status ${anon.status}`);
    assert(code(anon) === "PRESET_NOT_FOUND", `code ${code(anon)}`);
    const mine = await call("GET", `/presets/${draftId}`, { jar: owner });
    assert(mine.status === 200, `owner status ${mine.status}`);
    const preset = obj(mine.body?.preset, "preset");
    assert(preset.mine === true, "mine flag not set");
    assert(preset.status === "draft", "status not draft");
  });

  await check("detail: firmware mismatch warning against saved gear", async () => {
    const r = await call("GET", `/presets/${mainId}`, { jar: owner });
    assert(r.status === 200, `status ${r.status}`);
    const warning = obj(r.body?.preset, "preset").firmwareWarning;
    assert(typeof warning === "string", "firmwareWarning missing");
    assert(
      warning.includes("3.70") && warning.includes("3.50"),
      `warning lacks versions: ${warning}`,
    );
  });

  let anonDownloads = 0;
  await check("download: file preset streams exact bytes as attachment", async () => {
    const r = await call("GET", `/presets/${mainId}/download`);
    assert(r.status === 302, `status ${r.status}`);
    assert(r.location, "no Location header");
    assert(
      r.headers.get("cache-control") === "no-store",
      `cache-control=${String(r.headers.get("cache-control"))}`,
    );
    const res = await fetch(r.location);
    assert(res.status === 200, `object fetch -> ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert(bytes.equals(mainBytes), `bytes differ (${bytes.length} vs ${mainBytes.length})`);
    const disposition = res.headers.get("content-disposition") ?? "";
    assert(disposition.includes(`${slugify(mainTitle)}.hlx`), `disposition: ${disposition}`);
    anonDownloads += 1;
  });

  await check("download: counts grow but events dedupe once per day", async () => {
    const after1 = await call("GET", `/presets/${mainId}`);
    assert(
      Number(obj(obj(after1.body?.preset, "preset").counts, "counts").downloads) === 1,
      "downloads !== 1 after first download",
    );
    const second = await call("GET", `/presets/${mainId}/download`);
    assert(second.status === 302, `status ${second.status}`);
    anonDownloads += 1;
    const after2 = await call("GET", `/presets/${mainId}`);
    assert(
      Number(obj(obj(after2.body?.preset, "preset").counts, "counts").downloads) === 2,
      "downloads !== 2 after second download",
    );
    const events = await prisma.downloadEvent.count({ where: { presetId: mainId } });
    assert(
      events === 1,
      `expected 1 DownloadEvent row after ${anonDownloads} anon downloads, got ${events}`,
    );
  });

  await check("download: authed user gets its own event key", async () => {
    const r = await call("GET", `/presets/${mainId}/download`, { jar: owner });
    assert(r.status === 302, `status ${r.status}`);
    assert(r.location, "no Location header");
    const res = await fetch(r.location);
    assert(res.status === 200, `object fetch -> ${res.status}`);
    assert((await res.arrayBuffer()).byteLength === mainBytes.length, "byte length mismatch");
    const events = await prisma.downloadEvent.count({ where: { presetId: mainId } });
    assert(events === 2, `expected 2 DownloadEvent rows (anon+user), got ${events}`);
  });

  await check("download: cloud preset redirects to exact Cortex URL", async () => {
    const r = await call("GET", `/presets/${cloudId}/download`);
    assert(r.status === 302, `status ${r.status}`);
    assert(r.location === cloudUrl, `location=${String(r.location)}`);
  });

  await check("rate limit: anonymous downloads capped at 30/h", async () => {
    let limited = false;
    for (let i = 0; i < 35; i += 1) {
      const r = await call("GET", `/presets/${mainId}/download`);
      if (r.status === 429) {
        assert(code(r) === "RATE_LIMITED", `code ${code(r)}`);
        limited = true;
        break;
      }
      assert(r.status === 302, `unexpected status ${r.status}`);
    }
    assert(limited, "no 429 after 35 anonymous downloads");
  });

  // ------------------------------------------------------------ Phase 5 ---
  section("Phase 5 - Engagement (comments, votes, reports, hot ranking)");

  await check("setup: member account registered", async () => {
    const r = await call("POST", "/auth/register", {
      jar: member,
      body: registerBody(memberEmail, memberPassword),
    });
    assert(r.status === 201, `register -> ${r.status} ${code(r)}`);
    createdEmails.push(memberEmail);
    memberId = String(obj(obj(r.body?.user, "user"), "user").id);
  });

  await check("comment: brand-new accounts are gated by ACCOUNT_TOO_NEW", async () => {
    const r = await call("POST", `/presets/${mainId}/comments`, {
      jar: member,
      body: { bodyMd: "Fresh account, cannot comment yet" },
    });
    assert(r.status === 403, `status ${r.status}`);
    assert(code(r) === "ACCOUNT_TOO_NEW", `code ${code(r)}`);
  });

  await check("setup: member aged past the comment gate", async () => {
    await prisma.user.update({
      where: { id: memberId },
      data: { createdAt: new Date(Date.now() - 11 * 60_000) },
    });
    const row = await prisma.user.findUnique({
      where: { id: memberId },
      select: { createdAt: true },
    });
    assert(row && Date.now() - row.createdAt.getTime() >= 11 * 60_000, "member not backdated");
  });

  await check("comment: markdown is rendered and sanitized", async () => {
    const r = await call("POST", `/presets/${mainId}/comments`, {
      jar: member,
      body: { bodyMd: "Great *amp* tone! <script>alert(1)</script>" },
    });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    const comment = obj(obj(r.body?.comment, "comment"), "comment");
    commentId = String(comment.id);
    assert(
      String(comment.bodyHtml).includes("<em>amp</em>"),
      `bodyHtml=${String(comment.bodyHtml)}`,
    );
    assert(!String(comment.bodyHtml).includes("<script>"), "script survived sanitization");
    assert(typeof comment.bodyMd === "string" && comment.bodyMd.length > 0, "bodyMd missing");
  });

  await check("comment: one level of replies, deeper nesting rejected", async () => {
    const ok = await call("POST", `/presets/${mainId}/comments`, {
      jar: member,
      body: { bodyMd: "Agreed, this captures it", parentId: commentId },
    });
    assert(ok.status === 201, `reply -> ${ok.status} ${code(ok)}`);
    replyId = String(obj(obj(ok.body?.comment, "comment"), "comment").id);

    const deep = await call("POST", `/presets/${mainId}/comments`, {
      jar: member,
      body: { bodyMd: "Nesting deeper than allowed", parentId: replyId },
    });
    assert(deep.status === 400, `deep reply -> ${deep.status}`);
    assert(code(deep) === "COMMENT_PARENT_INVALID", `code ${code(deep)}`);
  });

  await check("comment: link spam rejected", async () => {
    const r = await call("POST", `/presets/${mainId}/comments`, {
      jar: member,
      body: {
        bodyMd:
          "[a](https://a.example) [b](https://b.example) [c](https://c.example) [d](https://d.example) [e](https://e.example)",
      },
    });
    assert(r.status === 400, `status ${r.status} ${code(r)}`);
    assert(code(r) === "COMMENT_TOO_MANY_LINKS", `code ${code(r)}`);
  });

  await check("comment: thread lists top-level with nested reply", async () => {
    const r = await call("GET", `/presets/${mainId}/comments`);
    assert(r.status === 200, `status ${r.status}`);
    const comments = list(r.body?.comments, "comments");
    const top = comments.find((c) => String(c.id) === commentId);
    assert(top, "top-level comment missing");
    assert(
      list(top.replies, "replies").some((x) => String(x.id) === replyId),
      "reply missing from thread",
    );
  });

  await check("vote: upvote returns live counts and userVote", async () => {
    const r = await call("PUT", `/presets/${mainId}/vote`, { jar: member, body: { value: 1 } });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const counts = obj(r.body?.counts, "counts");
    assert(Number(counts.up) >= 1, `up=${String(counts.up)}`);
    assert(
      Number(counts.score) === Number(counts.up) - Number(counts.down),
      "score is not up-down",
    );
    assert(r.body?.userVote === 1, `userVote=${String(r.body?.userVote)}`);
  });

  await check("vote: you cannot vote on your own preset", async () => {
    const r = await call("PUT", `/presets/${mainId}/vote`, { jar: owner, body: { value: 1 } });
    assert(r.status === 403, `status ${r.status} ${code(r)}`);
    assert(code(r) === "VOTE_OWN_PRESET", `code ${code(r)}`);
  });

  await check("vote: switching to down and clearing with zero", async () => {
    const down = await call("PUT", `/presets/${mainId}/vote`, { jar: member, body: { value: -1 } });
    assert(down.status === 200, `down -> ${down.status} ${code(down)}`);
    assert(Number(obj(down.body?.counts, "counts").down) >= 1, "down count missing");
    assert(down.body?.userVote === -1, `userVote=${String(down.body?.userVote)}`);

    const cleared = await call("PUT", `/presets/${mainId}/vote`, {
      jar: member,
      body: { value: 0 },
    });
    assert(cleared.status === 200, `clear -> ${cleared.status} ${code(cleared)}`);
    assert(cleared.body?.userVote === 0, `userVote=${String(cleared.body?.userVote)}`);
  });

  await check("hot rank: voting refreshes the cached hotRank", async () => {
    const read = async (): Promise<number> => {
      const row = await prisma.preset.findUnique({
        where: { id: mainId },
        select: { hotRank: true },
      });
      return Number(row?.hotRank ?? Number.NaN);
    };
    await call("PUT", `/presets/${mainId}/vote`, { jar: member, body: { value: 0 } });
    const before = await read();
    await call("PUT", `/presets/${mainId}/vote`, { jar: member, body: { value: 1 } });
    const after = await read();
    assert(Number.isFinite(after), `hotRank=${after}`);
    assert(after > before, `hotRank did not rise on an upvote (${before} -> ${after})`);
  });

  await check("preset detail: exposes counts, userVote and the thread", async () => {
    const asMember = await call("GET", `/presets/${mainId}`, { jar: member });
    assert(asMember.status === 200, `status ${asMember.status}`);
    const preset = obj(asMember.body?.preset, "preset");
    assert(preset.userVote === 1, `userVote=${String(preset.userVote)}`);
    const counts = obj(preset.counts, "counts");
    assert(Number(counts.comments) >= 2, `comments=${String(counts.comments)}`);
    assert(String(preset.id) === mainId, "id mismatch");

    const anon = await call("GET", `/presets/${mainId}`);
    assert(obj(anon.body?.preset, "preset").userVote === 0, "anon userVote should be 0");
  });

  await check("report: authenticated user reports a preset", async () => {
    const r = await call("POST", "/reports", {
      jar: member,
      body: {
        targetType: "preset",
        targetId: mainId,
        reason: "Sounds like an unlicensed tone clone",
      },
    });
    assert(r.status === 201, `status ${r.status} ${code(r)}`);
    mainReportId = String(obj(obj(r.body?.report, "report"), "report").id);
    assert(r.body?.report?.status === "open", `status=${String(r.body?.report?.status)}`);
  });

  await check("report: duplicate open report rejected", async () => {
    const r = await call("POST", "/reports", {
      jar: member,
      body: {
        targetType: "preset",
        targetId: mainId,
        reason: "Reporting this exact content again",
      },
    });
    assert(r.status === 409, `status ${r.status} ${code(r)}`);
    assert(code(r) === "REPORT_DUPLICATE", `code ${code(r)}`);
  });

  await check("report: anonymous, unknown target and short reason rejected", async () => {
    const anon = await call("POST", "/reports", {
      body: { targetType: "preset", targetId: mainId, reason: "Anonymous complaint about this" },
    });
    assert(anon.status === 401, `anon report -> ${anon.status}`);

    const missing = await call("POST", "/reports", {
      jar: member,
      body: {
        targetType: "preset",
        targetId: "does-not-exist",
        reason: "This target does not exist at all",
      },
    });
    assert(missing.status === 404, `missing target -> ${missing.status}`);
    assert(code(missing) === "REPORT_TARGET_NOT_FOUND", `code ${code(missing)}`);

    const short = await call("POST", "/reports", {
      jar: member,
      body: { targetType: "preset", targetId: mainId, reason: "too short" },
    });
    assert(short.status === 400, `short reason -> ${short.status}`);
  });

  // ------------------------------------------------------------ Phase 6 ---
  section("Phase 6 - Admin and moderation");

  await check("admin: anonymous and member callers are refused", async () => {
    const anon = await call("GET", "/admin/stats");
    assert(anon.status === 401, `anon -> ${anon.status}`);

    const memberOnly = await call("GET", "/admin/stats", { jar: member });
    assert(memberOnly.status === 403, `member -> ${memberOnly.status}`);
    assert(code(memberOnly) === "ADMIN_REQUIRED", `code ${code(memberOnly)}`);
  });

  await check("setup: moderator account registered and promoted to ADMIN", async () => {
    const r = await call("POST", "/auth/register", {
      jar: moderator,
      body: registerBody(moderatorEmail, moderatorPassword),
    });
    assert(r.status === 201, `register -> ${r.status} ${code(r)}`);
    createdEmails.push(moderatorEmail);
    moderatorId = String(obj(obj(r.body?.user, "user"), "user").id);

    await prisma.user.update({ where: { id: moderatorId }, data: { role: "ADMIN" } });
  });

  await check("admin: stats dashboard summarises the platform", async () => {
    const r = await call("GET", "/admin/stats", { jar: moderator });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const users = obj(r.body?.users, "users");
    assert(Number(users.total) >= 3, `users.total=${String(users.total)}`);
    const presets = obj(r.body?.presets, "presets");
    assert(Number(presets.total) >= 3, `presets.total=${String(presets.total)}`);
    const perPedal = list(r.body?.perPedal, "perPedal");
    assert(perPedal.length >= 28, `perPedal=${perPedal.length}`);
    assert(
      perPedal.some((p) => String(p.brand) === "Line 6"),
      "perPedal missing Line 6",
    );
  });

  await check("admin: pedal catalog lists every pedal with preset counts", async () => {
    const r = await call("GET", "/admin/pedals", { jar: moderator });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const pedals = list(r.body?.pedals, "pedals");
    assert(pedals.length >= 28, `pedals=${pedals.length}`);
    const stomp = pedals.find((p) => String(p.slug) === "line6-hx-stomp");
    assert(stomp, "line6-hx-stomp missing from admin catalog");
    assert(typeof stomp.presetCount === "number", `presetCount=${String(stomp.presetCount)}`);
  });

  let adminPedalId = "";
  await check("admin: creates a pedal, derives the slug, rejects duplicates", async () => {
    const payload = {
      brand: "Integration",
      model: `Pedal ${RUN}`,
      validationMode: "DEEP_JSON",
      extensions: [".itx"],
    };
    const created = await call("POST", "/admin/pedals", { jar: moderator, body: payload });
    assert(created.status === 201, `create -> ${created.status} ${code(created)}`);
    const pedal = obj(obj(created.body?.pedal, "pedal"), "pedal");
    adminPedalId = String(pedal.id);
    createdPedalIds.push(adminPedalId);
    assert(String(pedal.slug) === `integration-pedal-${RUN}`, `slug=${String(pedal.slug)}`);
    assert(pedal.enabled === true, "new pedal should be enabled");
    assert(
      Array.isArray(pedal.extensions) && pedal.extensions.length === 1,
      "extensions not stored",
    );

    const dup = await call("POST", "/admin/pedals", { jar: moderator, body: payload });
    assert(dup.status === 409, `duplicate -> ${dup.status} ${code(dup)}`);
    assert(code(dup) === "PEDAL_SLUG_TAKEN", `code ${code(dup)}`);
  });

  await check("admin: updates a pedal", async () => {
    const r = await call("PATCH", `/admin/pedals/${adminPedalId}`, {
      jar: moderator,
      body: { enabled: false, validationMode: "SHALLOW" },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const pedal = obj(obj(r.body?.pedal, "pedal"), "pedal");
    assert(pedal.enabled === false, "pedal not disabled");
    assert(
      String(pedal.validationMode) === "SHALLOW",
      `validationMode=${String(pedal.validationMode)}`,
    );
  });

  await check("admin: reports queue enriches targets and counts", async () => {
    const r = await call("GET", "/admin/reports", { jar: moderator });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const reports = list(r.body?.reports, "reports");
    const mine = reports.find((x) => String(x.id) === mainReportId);
    assert(mine, "open report missing from the queue");
    assert(String(mine.status) === "open", `status=${String(mine.status)}`);

    const target = obj(mine.target, "target");
    assert(
      String(target.type) === "preset" && String(target.id) === mainId,
      `target=${JSON.stringify(target)}`,
    );
    const ownerRow = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    assert(
      String(obj(target.owner, "owner").id) === String(ownerRow?.id),
      "target owner not enriched",
    );
    assert(String(target.title) === mainTitle, `title=${String(target.title)}`);
    assert(String(obj(mine.reporter, "reporter").id) === memberId, "reporter not enriched");

    const counts = obj(r.body?.counts, "counts");
    assert(Number(counts.open) >= 1, `counts.open=${String(counts.open)}`);
    assert(Number(counts.dismissed) === 0, `counts.dismissed=${String(counts.dismissed)}`);
  });

  await check("admin: dismiss leaves the reported preset published", async () => {
    const r = await call("POST", `/admin/reports/${mainReportId}/resolve`, {
      jar: moderator,
      body: { action: "dismiss", note: "Reviewed and allowed", password: moderatorPassword },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    assert(r.body?.report?.status === "dismissed", `status=${String(r.body?.report?.status)}`);
    assert(r.body?.report?.action === "dismiss", `action=${String(r.body?.report?.action)}`);

    const row = await prisma.preset.findUnique({ where: { id: mainId }, select: { status: true } });
    assert(String(row?.status) === "PUBLISHED", `preset status=${String(row?.status)}`);

    const again = await call("POST", `/admin/reports/${mainReportId}/resolve`, {
      jar: moderator,
      body: { action: "dismiss", password: moderatorPassword },
    });
    assert(again.status === 409, `re-resolve -> ${again.status}`);
    assert(code(again) === "REPORT_ALREADY_HANDLED", `code ${code(again)}`);
  });

  await check("setup: member reports the cloud preset for moderation", async () => {
    const r = await call("POST", "/reports", {
      jar: member,
      body: {
        targetType: "preset",
        targetId: cloudId,
        reason: "The linked cloud preset no longer resolves",
      },
    });
    assert(r.status === 201, `report -> ${r.status} ${code(r)}`);
    cloudReportId = String(obj(obj(r.body?.report, "report"), "report").id);
  });

  await check("setup: expire the moderator step-up window", async () => {
    await expireStepUp(moderator);
  });

  await check("admin: hiding a reported preset requires step-up", async () => {
    const noPassword = await call("POST", `/admin/reports/${cloudReportId}/resolve`, {
      jar: moderator,
      body: { action: "hide", note: "Trying to hide without a password" },
    });
    assert(noPassword.status === 403, `no password -> ${noPassword.status}`);
    assert(code(noPassword) === "STEP_UP_REQUIRED", `code ${code(noPassword)}`);

    const stillPublished = await prisma.preset.findUnique({
      where: { id: cloudId },
      select: { status: true },
    });
    assert(String(stillPublished?.status) !== "HIDDEN", "preset was hidden without step-up");
  });

  await check("admin: hide with step-up marks the preset HIDDEN", async () => {
    const r = await call("POST", `/admin/reports/${cloudReportId}/resolve`, {
      jar: moderator,
      body: { action: "hide", note: "Cloud link is dead", password: moderatorPassword },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    const row = await prisma.preset.findUnique({
      where: { id: cloudId },
      select: { status: true, statusReason: true },
    });
    assert(String(row?.status) === "HIDDEN", `status=${String(row?.status)}`);
    assert(
      String(row?.statusReason) === "Cloud link is dead",
      `reason=${String(row?.statusReason)}`,
    );

    const reported = await call("GET", `/presets/${cloudId}`);
    assert(reported.status === 404, `hidden preset still publicly visible -> ${reported.status}`);

    const resolved = await call("GET", "/admin/reports?status=resolved", { jar: moderator });
    assert(resolved.status === 200, `resolved queue -> ${resolved.status}`);
    assert(
      list(resolved.body?.reports, "reports").some((x) => String(x.id) === cloudReportId),
      "resolved report missing from the resolved queue",
    );
  });

  await check("admin: tag governance - create, blacklist, merge", async () => {
    await expireStepUp(moderator);
    tagSlugA = `it-tag-a-${RUN}`;
    tagSlugB = `it-tag-b-${RUN}`;

    const a = await call("POST", "/admin/tags", {
      jar: moderator,
      body: { slug: tagSlugA, label: `IT Tag A ${RUN}` },
    });
    assert(a.status === 201, `create a -> ${a.status} ${code(a)}`);
    tagIdA = String(obj(obj(a.body?.tag, "tag"), "tag").id);

    const b = await call("POST", "/admin/tags", {
      jar: moderator,
      body: { slug: tagSlugB, label: `IT Tag B ${RUN}` },
    });
    assert(b.status === 201, `create b -> ${b.status} ${code(b)}`);
    tagIdB = String(obj(obj(b.body?.tag, "tag"), "tag").id);

    const adminList = await call("GET", "/admin/tags", { jar: moderator });
    assert(adminList.status === 200, `admin list -> ${adminList.status}`);
    assert(
      list(adminList.body?.tags, "tags").some((t) => String(t.slug) === tagSlugA),
      "created tag missing from the admin list",
    );

    const publicBefore = await call("GET", "/tags");
    assert(publicBefore.status === 200, `public list -> ${publicBefore.status}`);
    assert(
      list(publicBefore.body?.tags, "tags").some((t) => String(t.slug) === tagSlugA),
      "fresh tag missing from the public list",
    );

    const withoutStepUp = await call("PATCH", `/admin/tags/${tagIdA}`, {
      jar: moderator,
      body: { blacklisted: true },
    });
    assert(withoutStepUp.status === 403, `blacklist without password -> ${withoutStepUp.status}`);
    assert(code(withoutStepUp) === "STEP_UP_REQUIRED", `code ${code(withoutStepUp)}`);

    const blocked = await call("PATCH", `/admin/tags/${tagIdA}`, {
      jar: moderator,
      body: { blacklisted: true, password: moderatorPassword },
    });
    assert(blocked.status === 200, `blacklist -> ${blocked.status} ${code(blocked)}`);
    assert(blocked.body?.tag?.blacklisted === true, "tag not flagged blacklisted");

    const publicAfter = await call("GET", "/tags");
    assert(
      !list(publicAfter.body?.tags, "tags").some((t) => String(t.slug) === tagSlugA),
      "blacklisted tag still public",
    );

    const merged = await call("POST", `/admin/tags/${tagIdB}/merge`, {
      jar: moderator,
      body: { targetTagId: tagIdA, password: moderatorPassword },
    });
    assert(merged.status === 200, `merge -> ${merged.status} ${code(merged)}`);
    const merge = obj(obj(merged.body?.merged, "merged"), "merged");
    assert(String(merge.targetSlug) === tagSlugA, `targetSlug=${String(merge.targetSlug)}`);
    assert(String(merge.sourceSlug) === tagSlugB, `sourceSlug=${String(merge.sourceSlug)}`);

    const sourceGone = await prisma.tag.findUnique({ where: { id: tagIdB } });
    assert(!sourceGone, "source tag survived the merge");
  });

  await check("admin: hard ban revokes the member's sessions", async () => {
    const r = await call("POST", `/admin/users/${memberId}/ban`, {
      jar: moderator,
      body: { type: "hard", reason: "Integration abuse test", password: moderatorPassword },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    assert(r.body?.user?.banned === true, "banned flag missing");

    const me = await call("GET", "/me", { jar: member });
    assert(me.status === 401, `member /me after ban -> ${me.status}`);
  });

  await check("admin: unbanning restores access", async () => {
    const r = await call("POST", `/admin/users/${memberId}/unban`, {
      jar: moderator,
      body: { password: moderatorPassword },
    });
    assert(r.status === 200, `status ${r.status} ${code(r)}`);
    assert(r.body?.user?.banned === false, "banned flag not cleared");

    const fresh = new Jar();
    const login = await call("POST", "/auth/login", {
      jar: fresh,
      body: { email: memberEmail, password: memberPassword },
    });
    assert(login.status === 200, `re-login -> ${login.status} ${code(login)}`);
    const me = await call("GET", "/me", { jar: fresh });
    assert(me.status === 200, `member /me after unban -> ${me.status}`);
  });

  // ------------------------------------------------- cross-cutting limits ---
  section("Cross-cutting rate limits");

  await check("rate limit: register capped at 5/h per IP", async () => {
    let limited = false;
    for (let i = 0; i < 6; i += 1) {
      const junk = `it-junk${i}-${RUN}@example.com`;
      const r = await call("POST", "/auth/register", { body: registerBody(junk, password2) });
      if (r.status === 429) {
        assert(code(r) === "RATE_LIMITED", `code ${code(r)}`);
        limited = true;
        break;
      }
      assert(r.status === 201, `junk register -> ${r.status} ${code(r)}`);
      createdEmails.push(junk);
    }
    assert(limited, "register never hit 429");
  });

  // ------------------------------------------------------------- summary ---
  console.log(`\n${passed} passed, ${failed} failed (${BASE_URL})`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  return failed > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- cleanup ---

async function cleanup(): Promise<void> {
  if (KEEP) {
    console.log("--keep: skipping cleanup of this run's data");
    return;
  }
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: createdEmails } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const presets = await prisma.preset.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    if (presets.length > 0) {
      await prisma.preset.deleteMany({ where: { id: { in: presets.map((p) => p.id) } } });
    }
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (createdPedalIds.length > 0) {
      await prisma.pedal.deleteMany({ where: { id: { in: createdPedalIds } } });
    }
    if (tagIdB) await prisma.presetTag.deleteMany({ where: { tagId: tagIdB } });
    if (tagIdA || tagIdB) {
      await prisma.tag.deleteMany({ where: { id: { in: [tagIdA, tagIdB].filter(Boolean) } } });
    }
    for (const p of presets) {
      await rm(path.join(STORAGE_DIR, "presets", p.id), { recursive: true, force: true });
    }
    for (const id of userIds) {
      await rm(path.join(STORAGE_DIR, "quarantine", id), { recursive: true, force: true });
    }
    console.log(
      `Cleanup: removed ${userIds.length} user(s), ${presets.length} preset(s) and their stored files.`,
    );
  } catch (err) {
    console.warn("Cleanup failed:", err instanceof Error ? err.message : err);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(async (exitCode) => {
    await cleanup();
    process.exit(exitCode);
  })
  .catch(async (err) => {
    console.error("Integration run crashed:", err);
    await cleanup();
    process.exit(1);
  });
