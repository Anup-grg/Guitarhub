import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { burnPasswordTime, hashPassword, isBreachedPassword, verifyPassword } from "./password.js";

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

describe("isBreachedPassword (HIBP k-anonymity range check)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function suffixOf(password: string) {
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    return sha1.slice(5);
  }

  it("reports a password whose hash suffix appears with a count", async () => {
    const body = `000000000000000000000000000000000000000:1\r\n${suffixOf(PASSWORD)}:42\r\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    expect(await isBreachedPassword(PASSWORD)).toBe(true);
  });

  it("returns false when the suffix is absent or the count is zero", async () => {
    const missing = `000000000000000000000000000000000000000:7\r\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(missing, { status: 200 })),
    );
    expect(await isBreachedPassword(PASSWORD)).toBe(false);

    const zero = `${suffixOf(PASSWORD)}:0\r\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(zero, { status: 200 })),
    );
    expect(await isBreachedPassword(PASSWORD)).toBe(false);
  });

  it("returns false when HIBP answers with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 503 })),
    );

    expect(await isBreachedPassword(PASSWORD)).toBe(false);
  });

  it("fails open when the network call throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(await isBreachedPassword(PASSWORD)).toBe(false);
  });
});
