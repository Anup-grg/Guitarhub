import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "../lib/prisma.js";
import { createApp } from "../app.js";

const app = createApp();
const queryRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  queryRaw.mockReset();
});

describe("GET /api/v1/health", () => {
  it("reports ok when the database responds", async () => {
    queryRaw.mockResolvedValueOnce([{ ok: 1 }] as never);
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "guitarhub-api",
      db: "up",
    });
    expect(typeof res.body.time).toBe("string");
  });

  it("reports degraded when the database is unreachable", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connection refused") as never);
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "degraded", db: "down" });
  });
});

describe("error handling", () => {
  it("returns RFC 9457 problem+json for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
    });
    expect(res.body.detail).toContain("/api/v1/does-not-exist");
  });

  it("returns 400 problem+json for malformed JSON bodies", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send("{ this is not json");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.code).toBe("BAD_REQUEST");
  });
});

describe("security headers (helmet)", () => {
  it("sets nosniff on responses", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not expose the X-Powered-By header", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
