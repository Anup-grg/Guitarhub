import { describe, expect, it } from "vitest";
import { burnPasswordTime, hashPassword, verifyPassword } from "./password.js";

const PASSWORD = "correct-horse-battery-staple-42";

describe("password hashing (argon2id)", () => {
  it("hashes with the argon2id algorithm", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it("verifies the correct password and rejects the wrong one", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "not-the-password")).toBe(false);
  });

  it("salts each hash so identical passwords differ", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it("returns false instead of throwing on a corrupt stored hash", async () => {
    expect(await verifyPassword("not-a-hash", PASSWORD)).toBe(false);
    expect(await verifyPassword("", PASSWORD)).toBe(false);
  });

  it("burnPasswordTime resolves without leaking", async () => {
    await expect(burnPasswordTime("anything")).resolves.toBeUndefined();
  });
});
