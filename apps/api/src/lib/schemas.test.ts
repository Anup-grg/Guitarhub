import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config.js";
import { displayNameSchema, emailSchema, passwordSchema, tosSchema } from "./schemas.js";

const PASSWORD = "correct-horse-battery-staple-42";

describe("passwordSchema", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    env.HIBP_CHECK = false;
  });

  it("rejects passwords shorter than the minimum", async () => {
    await expect(passwordSchema.parseAsync("short12345")).rejects.toThrow(/at least 12/);
  });

  it("skips the HIBP range check when it is disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(passwordSchema.parseAsync(PASSWORD)).resolves.toBe(PASSWORD);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a password that appears in a breach when HIBP checking is on", async () => {
    env.HIBP_CHECK = true;
    const suffix = createHash("sha1").update(PASSWORD, "utf8").digest("hex").toUpperCase().slice(5);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`${suffix}:99\r\n`, { status: 200 })),
    );

    await expect(passwordSchema.parseAsync(PASSWORD)).rejects.toThrow(/known data breach/);
  });

  it("accepts an unknown password when HIBP checking is on", async () => {
    env.HIBP_CHECK = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("000000000000000000000000000000000000000:3\r\n", { status: 200 }),
      ),
    );

    await expect(passwordSchema.parseAsync(PASSWORD)).resolves.toBe(PASSWORD);
  });
});

describe("tosSchema", () => {
  it("explains a missing Terms of Service acceptance", async () => {
    await expect(
      tosSchema.parseAsync({ tosVersion: "1.0", acceptTerms: false, acceptGuidelines: true }),
    ).rejects.toThrow("You must accept the Terms of Service");

    await expect(
      tosSchema.parseAsync({ tosVersion: "1.0", acceptTerms: true, acceptGuidelines: false }),
    ).rejects.toThrow("You must accept the Community Guidelines");
  });
});

describe("emailSchema / displayNameSchema", () => {
  it("trims and lower-cases addresses", () => {
    expect(emailSchema.parse("  Mixed.Case@Example.COM ")).toBe("mixed.case@example.com");
  });

  it("rejects unsupported characters in display names and keeps a leading @", () => {
    expect(() => displayNameSchema.parse("Bo<ld>")).toThrow(/unsupported characters/);
    expect(displayNameSchema.parse("@axe")).toBe("@axe");
    expect(() => displayNameSchema.parse("x".repeat(41))).toThrow();
  });
});
