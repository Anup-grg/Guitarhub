import express, { Router } from "express";
import { createHash } from "node:crypto";
import { ApiError } from "../errors/problem.js";
import {
  attachmentDisposition,
  getStorage,
  putLocalObject,
  verifyLocalDownloadToken,
  verifyLocalUploadToken,
} from "../lib/storage.js";

export const storageLocalRouter = Router();

/**
 * Local stand-in for an S3 pre-signed PUT (STORAGE_DRIVER=local).
 * The HMAC token binds key, expiry and size cap; nothing else about the
 * request is trusted (FR-2.4 / NFR-5).
 */
storageLocalRouter.put(
  "/upload/:token",
  (req, res, next) => {
    // Verify before reading a single body byte so a bad token never receives
    // the payload.
    const info = verifyLocalUploadToken(String(req.params.token));
    // The transport cap is the token's cap, not a hard-coded ceiling: pedals
    // configured above 21 mb must still accept their full allowance, and any
    // over-cap body surfaces as FILE_SIZE_EXCEEDED rather than a generic code.
    express.raw({ type: () => true, limit: info.maxBytes })(req, res, (err) => {
      if (err && (err as { type?: string }).type === "entity.too.large") {
        next(
          new ApiError(
            413,
            "FILE_SIZE_EXCEEDED",
            `File is larger than the ${info.maxBytes} byte limit for this pedal`,
          ),
        );
        return;
      }
      next(err);
    });
  },
  async (req, res) => {
    const info = verifyLocalUploadToken(String(req.params.token));
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ApiError(400, "FILE_EMPTY", "The uploaded file is empty");
    }
    if (body.length > info.maxBytes) {
      throw new ApiError(
        413,
        "FILE_SIZE_EXCEEDED",
        `File is larger than the ${info.maxBytes} byte limit for this pedal`,
      );
    }
    await putLocalObject(info.key, body);
    res.status(201).json({ ok: true, size: body.length });
  },
);

/**
 * Local stand-in for an S3 pre-signed GET: streams the object back as an
 * attachment. The HMAC token binds key, expiry and the suggested filename.
 */
storageLocalRouter.get("/download/:token", async (req, res) => {
  const info = verifyLocalDownloadToken(String(req.params.token));
  const bytes = await getStorage().get(info.key);
  if (!bytes) {
    throw new ApiError(404, "PRESET_FILE_NOT_FOUND", "The preset file is no longer available");
  }
  const etag = createHash("sha256").update(bytes).digest("hex");
  res
    .status(200)
    .set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(info.filename),
      "Content-Length": String(bytes.length),
      ETag: `"${etag}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    })
    .send(bytes);
});
