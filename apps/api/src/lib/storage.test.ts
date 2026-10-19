import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { env } from "../config.js";
import { ApiError } from "../errors/problem.js";
import {
  assertSafeKey,
  attachmentDisposition,
  getStorage,
  putLocalObject,
  setStorage,
  signLocalDownloadToken,
  signLocalUploadToken,
  verifyLocalDownloadToken,
  verifyLocalUploadToken,
} from "./storage.js";

const app = createApp();
const TEST_DIR = `.local-objects-test-${process.pid}`;

const original = { dir: env.STORAGE_LOCAL_DIR };

beforeAll(() => {
  env.STORAGE_LOCAL_DIR = TEST_DIR;
});

afterAll(async () => {
  env.STORAGE_LOCAL_DIR = original.dir;
  await rm(path.resolve(process.cwd(), TEST_DIR), { recursive: true, force: true });
});

afterEach(() => {
  setStorage(null);
});

describe("assertSafeKey", () => {
  it.each([
    "quarantine/u1/abc/file.hlx",
    "presets/p1/v1/primary.hlx",
    "quarantine/01M4DDCT41S78VDZ1Z8YVTN4YD/01ABC/file.hlx",
    "a",
  ])("accepts %s", (key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });

  it.each(["../etc/passwd", "a/../b", "/abs/key", "key with space", "a//b", ""])(
    "rejects %s",
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(ApiError);
    },
  );
});

describe("local upload tokens", () => {
  it("round-trips a signed token", () => {
    const token = signLocalUploadToken({
      key: "quarantine/u1/x/file.hlx",
      exp: Math.floor(Date.now() / 1000) + 60,
      maxBytes: 1000,
    });
    expect(verifyLocalUploadToken(token)).toEqual({
      key: "quarantine/u1/x/file.hlx",
      exp: expect.any(Number),
      maxBytes: 1000,
    });
  });

  it("rejects tampered payloads", () => {
    const token = signLocalUploadToken({
      key: "quarantine/u1/x/file.hlx",
      exp: Math.floor(Date.now() / 1000) + 60,
      maxBytes: 1000,
    });
    const [payload, sig] = token.split(".") as [string, string];
    const evil = Buffer.from(
      JSON.stringify({ key: "quarantine/u1/x/file.hlx", exp: 9999999999, maxBytes: 1e9 }),
      "utf8",
    ).toString("base64url");
    expect(() => verifyLocalUploadToken(`${evil}.${sig}`)).toThrow(ApiError);
    expect(() => verifyLocalUploadToken(`${payload}.AAAA${sig.slice(4)}`)).toThrow(ApiError);
  });

  it("rejects expired tokens", () => {
    const token = signLocalUploadToken({
      key: "quarantine/u1/x/file.hlx",
      exp: Math.floor(Date.now() / 1000) - 5,
      maxBytes: 1000,
    });
    try {
      verifyLocalUploadToken(token);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("UPLOAD_TOKEN_EXPIRED");
    }
  });
});

describe("local object storage", () => {
  it("stores, moves and removes objects on disk", async () => {
    const storage = getStorage();
    expect(storage.driver).toBe("local");

    await putLocalObject("quarantine/u1/tmp/hello.hlx", Buffer.from("payload"));
    expect((await storage.get("quarantine/u1/tmp/hello.hlx"))?.toString()).toBe("payload");

    await storage.move("quarantine/u1/tmp/hello.hlx", "presets/p1/v1/primary.hlx");
    expect(await storage.get("quarantine/u1/tmp/hello.hlx")).toBeNull();
    expect((await storage.get("presets/p1/v1/primary.hlx"))?.toString()).toBe("payload");

    await storage.remove("presets/p1/v1/primary.hlx");
    expect(await storage.get("presets/p1/v1/primary.hlx")).toBeNull();
  });

  it("presigns a local PUT url bound to the API", async () => {
    const put = await getStorage().presignPut("quarantine/u1/x/file.hlx", { maxBytes: 500 });
    expect(put.url).toContain(`${env.APP_URL}/api/v1/storage/local/upload/`);
    expect(put.headers["Content-Type"]).toBe("application/octet-stream");
    expect(new Date(put.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("PUT /api/v1/storage/local/upload/:token", () => {
  const key = "quarantine/u1/abc/file.hlx";

  function tokenFor(maxBytes = 1024, expSec = 300): string {
    return signLocalUploadToken({
      key,
      exp: Math.floor(Date.now() / 1000) + expSec,
      maxBytes,
    });
  }

  beforeEach(async () => {
    await putLocalObject(key, Buffer.from("stale"));
  });

  it("accepts a signed upload and overwrites the object", async () => {
    const res = await request(app)
      .put(`/api/v1/storage/local/upload/${tokenFor()}`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("fresh-bytes"));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, size: 11 });
    expect((await getStorage().get(key))?.toString()).toBe("fresh-bytes");
  });

  it("403s a tampered or malformed token", async () => {
    const res = await request(app)
      .put("/api/v1/storage/local/upload/not-a-token")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("data"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UPLOAD_TOKEN_INVALID");
  });

  it("413s payloads above the token's size cap", async () => {
    const res = await request(app)
      .put(`/api/v1/storage/local/upload/${tokenFor(5)}`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("too big"));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("FILE_SIZE_EXCEEDED");
  });

  it("413s chunked payloads above the cap with the same code", async () => {
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/storage/local/upload/${tokenFor(5)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          // A stream body forces chunked framing, so the cap can only be
          // enforced mid-stream rather than from Content-Length.
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(64));
              controller.close();
            },
          }),
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe("FILE_SIZE_EXCEEDED");
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("400s empty uploads", async () => {
    const res = await request(app)
      .put(`/api/v1/storage/local/upload/${tokenFor()}`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_EMPTY");
  });

  it("accepts bodies above the old hard-coded 21 mb transport ceiling", async () => {
    const overOldLimit = 21 * 1024 * 1024 + 1;
    const res = await request(app)
      .put(`/api/v1/storage/local/upload/${tokenFor(overOldLimit + 16)}`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(overOldLimit, 0x41));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, size: overOldLimit });
  });
});

describe("attachmentDisposition", () => {
  it("emits an ASCII-safe fallback for a plain filename", () => {
    expect(attachmentDisposition("crunch-box.hlx")).toBe(
      "attachment; filename=\"crunch-box.hlx\"; filename*=UTF-8''crunch-box.hlx",
    );
  });

  it("encodes quotes, parens and non-ASCII bytes for RFC 5987", () => {
    const header = attachmentDisposition("It's (a) ƒøø.hlx");
    expect(header).toContain(`filename="It's (a) ___.hlx"`);
    expect(header).toContain(`filename*=UTF-8''It%27s%20%28a%29%20%C6%92%C3%B8%C3%B8.hlx`);
  });

  it("neutralizes newlines and backslashes in the fallback name", () => {
    const header = attachmentDisposition("evil\r\nname\\.hlx");
    expect(header).toContain('filename="evil__name_.hlx"');
  });
});

describe("local download tokens", () => {
  it("round-trips key, expiry and filename", () => {
    const token = signLocalDownloadToken({
      key: "presets/p1/v1/primary.hlx",
      exp: Math.floor(Date.now() / 1000) + 60,
      filename: "crunch-box.hlx",
    });
    expect(verifyLocalDownloadToken(token)).toEqual({
      key: "presets/p1/v1/primary.hlx",
      exp: expect.any(Number),
      filename: "crunch-box.hlx",
    });
  });

  it("rejects tampered payloads with DOWNLOAD_TOKEN_INVALID", () => {
    const token = signLocalDownloadToken({
      key: "presets/p1/v1/primary.hlx",
      exp: Math.floor(Date.now() / 1000) + 60,
      filename: "crunch-box.hlx",
    });
    const [payload, sig] = token.split(".") as [string, string];
    const evil = Buffer.from(
      JSON.stringify({
        key: "presets/p1/v1/primary.hlx",
        exp: 9999999999,
        filename: "evil.hlx",
      }),
      "utf8",
    ).toString("base64url");
    try {
      verifyLocalDownloadToken(`${evil}.${sig}`);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("DOWNLOAD_TOKEN_INVALID");
    }
    try {
      const flipped = `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
      verifyLocalDownloadToken(`${payload}.${flipped}`);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("DOWNLOAD_TOKEN_INVALID");
    }
  });

  it("reports expiry with DOWNLOAD_TOKEN_EXPIRED", () => {
    const token = signLocalDownloadToken({
      key: "presets/p1/v1/primary.hlx",
      exp: Math.floor(Date.now() / 1000) - 5,
      filename: "crunch-box.hlx",
    });
    try {
      verifyLocalDownloadToken(token);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("DOWNLOAD_TOKEN_EXPIRED");
    }
  });
});

describe("presignGet", () => {
  it("mints a local download URL bound to the token", async () => {
    const get = await getStorage().presignGet("presets/p1/v1/primary.hlx", {
      filename: "crunch-box.hlx",
    });
    expect(get.url).toContain(`${env.APP_URL}/api/v1/storage/local/download/`);
    expect(new Date(get.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/v1/storage/local/download/:token", () => {
  const key = "presets/dl/v1/primary.hlx";

  function tokenFor(filename = "crunch-box.hlx", expSec = 300): string {
    return signLocalDownloadToken({
      key,
      exp: Math.floor(Date.now() / 1000) + expSec,
      filename,
    });
  }

  beforeEach(async () => {
    await putLocalObject(key, Buffer.from("preset-bytes"));
  });

  it("streams the object with attachment headers, ETag and immutable caching", async () => {
    const res = await request(app).get(`/api/v1/storage/local/download/${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain('filename="crunch-box.hlx"');
    expect(res.headers["content-length"]).toBe(String("preset-bytes".length));
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers.etag).toBe(`"${createHash("sha256").update("preset-bytes").digest("hex")}"`);
    expect(Buffer.from(res.body).toString()).toBe("preset-bytes");
  });

  it("403s a tampered or malformed token", async () => {
    const res = await request(app).get("/api/v1/storage/local/download/not-a-token");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DOWNLOAD_TOKEN_INVALID");
  });

  it("403s an expired token", async () => {
    const res = await request(app).get(`/api/v1/storage/local/download/${tokenFor("x.hlx", -5)}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DOWNLOAD_TOKEN_EXPIRED");
  });

  it("404s when the object no longer exists", async () => {
    await getStorage().remove(key);
    const res = await request(app).get(`/api/v1/storage/local/download/${tokenFor()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PRESET_FILE_NOT_FOUND");
  });
});
