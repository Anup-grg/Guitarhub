import { describe, expect, it } from "vitest";
import { newId } from "./id.js";

const CROCKFORD = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

function decodeTimePrefix(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) {
    const v = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(ch);
    expect(v).toBeGreaterThanOrEqual(0);
    t = t * 32 + v;
  }
  return t;
}

describe("newId (ULID)", () => {
  it("returns a 26-character Crockford base32 string", () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(CROCKFORD);
  });

  it("encodes the current time in the first 10 characters", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const ts = decodeTimePrefix(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("is unique across a large batch", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(newId());
    expect(ids.size).toBe(10_000);
  });

  it("has a non-decreasing time prefix", () => {
    let prev = 0;
    for (let i = 0; i < 2_000; i++) {
      const ts = decodeTimePrefix(newId());
      expect(ts).toBeGreaterThanOrEqual(prev);
      prev = ts;
    }
  });

  it("never contains excluded characters I, L, O, U", () => {
    for (let i = 0; i < 1_000; i++) {
      expect(newId()).not.toMatch(/[ILOU]/);
    }
  });
});
