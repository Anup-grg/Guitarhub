import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config.js";
import { ApiError } from "../errors/problem.js";

export type PresignedPut = {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type PresignedGet = {
  url: string;
  expiresAt: string;
};

/**
 * RFC 6266/5987 Content-Disposition for attachment downloads: an ASCII-safe
 * fallback name plus a UTF-8 `filename*` for non-ASCII characters.
 */
export function attachmentDisposition(filename: string): string {
  const safe = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\\n\r]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${safe}"; filename*=UTF-8''${utf8}`;
}

export interface ObjectStorage {
  readonly driver: "local" | "s3";
  presignPut(
    key: string,
    opts: { maxBytes: number; expiresSec?: number; contentType?: string },
  ): Promise<PresignedPut>;
  presignGet(
    key: string,
    opts: { filename: string; expiresSec?: number; contentType?: string },
  ): Promise<PresignedGet>;
  get(key: string): Promise<Buffer | null>;
  move(fromKey: string, toKey: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Storage keys are always lowercase, slash-separated and never contain `..`. */
const SAFE_KEY = /^[a-z0-9][a-z0-9/._-]*$/i;

export function assertSafeKey(key: string): void {
  if (key.length > 400 || !SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new ApiError(400, "INVALID_STORAGE_KEY", "Invalid storage key");
  }
}

/** Repository root (apps/api) regardless of src/ or dist/ execution. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function localPath(key: string): string {
  assertSafeKey(key);
  const base = path.resolve(ROOT, env.STORAGE_LOCAL_DIR);
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) {
    throw new ApiError(400, "INVALID_STORAGE_KEY", "Invalid storage key");
  }
  return full;
}

export type LocalUploadToken = { key: string; exp: number; maxBytes: number };
export type LocalDownloadToken = { key: string; exp: number; filename: string };

function hmac(payload: string): string {
  return createHmac("sha256", env.STORAGE_SIGNING_SECRET).update(payload).digest("base64url");
}

function signToken<T extends Record<string, unknown>>(info: T): string {
  const payload = Buffer.from(JSON.stringify(info), "utf8").toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

function verifyToken<T extends Record<string, unknown>>(
  token: string,
  isWellFormed: (info: T) => boolean,
  invalidCode: string,
  expiredCode: string,
): T {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new ApiError(403, invalidCode, "This link is not valid");
  }
  const [payload, sig] = parts as [string, string];
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(403, invalidCode, "This link is not valid");
  }
  let info: T | null = null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
    if (isWellFormed(parsed)) info = parsed;
  } catch {
    info = null;
  }
  if (!info) {
    throw new ApiError(403, invalidCode, "This link is not valid");
  }
  if (Number(info.exp) * 1000 <= Date.now()) {
    throw new ApiError(403, expiredCode, "This link has expired — request a new one");
  }
  assertSafeKey(String(info.key));
  return info;
}

export function signLocalUploadToken(info: LocalUploadToken): string {
  return signToken(info);
}

export function verifyLocalUploadToken(token: string): LocalUploadToken {
  return verifyToken<LocalUploadToken>(
    token,
    (info) =>
      typeof info.key === "string" &&
      typeof info.exp === "number" &&
      typeof info.maxBytes === "number",
    "UPLOAD_TOKEN_INVALID",
    "UPLOAD_TOKEN_EXPIRED",
  );
}

export function signLocalDownloadToken(info: LocalDownloadToken): string {
  return signToken(info);
}

export function verifyLocalDownloadToken(token: string): LocalDownloadToken {
  return verifyToken<LocalDownloadToken>(
    token,
    (info) =>
      typeof info.key === "string" &&
      typeof info.exp === "number" &&
      typeof info.filename === "string",
    "DOWNLOAD_TOKEN_INVALID",
    "DOWNLOAD_TOKEN_EXPIRED",
  );
}

class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;

  async presignPut(
    key: string,
    opts: { maxBytes: number; expiresSec?: number; contentType?: string },
  ): Promise<PresignedPut> {
    assertSafeKey(key);
    const expiresSec = opts.expiresSec ?? 900;
    const token = signLocalUploadToken({
      key,
      exp: Math.floor(Date.now() / 1000) + expiresSec,
      maxBytes: opts.maxBytes,
    });
    const headers: Record<string, string> = {
      "Content-Type": opts.contentType ?? "application/octet-stream",
    };
    return {
      url: `${env.APP_URL}/api/v1/storage/local/upload/${token}`,
      headers,
      expiresAt: new Date(Date.now() + expiresSec * 1000).toISOString(),
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(localPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async presignGet(
    key: string,
    opts: { filename: string; expiresSec?: number; contentType?: string },
  ): Promise<PresignedGet> {
    assertSafeKey(key);
    const expiresSec = opts.expiresSec ?? 900;
    const token = signLocalDownloadToken({
      key,
      exp: Math.floor(Date.now() / 1000) + expiresSec,
      filename: opts.filename,
    });
    return {
      url: `${env.APP_URL}/api/v1/storage/local/download/${token}`,
      expiresAt: new Date(Date.now() + expiresSec * 1000).toISOString(),
    };
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const from = localPath(fromKey);
    const to = localPath(toKey);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(localPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export async function putLocalObject(key: string, bytes: Buffer): Promise<void> {
  const target = localPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;
  #client: unknown;
  #bucket = env.STORAGE_BUCKET;

  async #getClient(): Promise<{
    send: (cmd: unknown) => Promise<Record<string, unknown>>;
  }> {
    if (!this.#client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.#client = new S3Client({
        region: env.STORAGE_REGION,
        endpoint: env.STORAGE_ENDPOINT,
        forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.STORAGE_ACCESS_KEY,
          secretAccessKey: env.STORAGE_SECRET_KEY,
        },
      });
    }
    return this.#client as { send: (cmd: unknown) => Promise<Record<string, unknown>> };
  }

  async presignPut(
    key: string,
    opts: { maxBytes: number; expiresSec?: number; contentType?: string },
  ): Promise<PresignedPut> {
    assertSafeKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.#getClient();
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      ContentType: opts.contentType ?? "application/octet-stream",
    });
    const expiresIn = opts.expiresSec ?? 900;
    const url = await getSignedUrl(client as never, command as never, { expiresIn });
    return {
      url,
      headers: { "Content-Type": opts.contentType ?? "application/octet-stream" },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.#getClient();
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }) as never,
      );
      const body = out.Body as { transformToByteArray?: () => Promise<Uint8Array> };
      if (!body?.transformToByteArray) return null;
      return Buffer.from(await body.transformToByteArray());
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }

  async presignGet(
    key: string,
    opts: { filename: string; expiresSec?: number; contentType?: string },
  ): Promise<PresignedGet> {
    assertSafeKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.#getClient();
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      ResponseContentType: opts.contentType ?? "application/octet-stream",
      ResponseContentDisposition: attachmentDisposition(opts.filename),
    });
    const expiresIn = opts.expiresSec ?? 900;
    const url = await getSignedUrl(client as never, command as never, { expiresIn });
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    assertSafeKey(fromKey);
    assertSafeKey(toKey);
    const { CopyObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.#getClient();
    await client.send(
      new CopyObjectCommand({
        Bucket: this.#bucket,
        CopySource: `${this.#bucket}/${fromKey}`,
        Key: toKey,
        MetadataDirective: "COPY",
      }) as never,
    );
    await client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: fromKey }) as never);
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.#getClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }) as never);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== "NoSuchKey" && name !== "NotFound") throw err;
    }
  }
}

let instance: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (!instance) instance = env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
  return instance;
}

/** Test hook — swap the storage implementation. */
export function setStorage(storage: ObjectStorage | null): void {
  instance = storage;
}
