import { describe, expect, it } from "vitest";
import { hashToken, randomToken, safeEqual } from "./tokens.js";

describe("randomToken", () => {
  it("produces URL-safe tokens of the requested entropy", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url").length).toBe(32);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(seen.size).toBe(100);
  });
});

describe("hashToken", () => {
  it("is deterministic sha256 hex", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("safeEqual", () => {
  it("matches identical strings and rejects different ones", () => {
    expect(safeEqual("deadbeef", "deadbeef")).toBe(true);
    expect(safeEqual("deadbeef", "deadbeee")).toBe(false);
    expect(safeEqual("short", "longer-value")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
