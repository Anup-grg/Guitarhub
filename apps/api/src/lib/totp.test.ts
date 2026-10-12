import { generate } from "otplib";
import { describe, expect, it } from "vitest";
import {
  createTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from "./totp.js";

describe("TOTP (RFC 6238)", () => {
  it("creates base32 secrets", () => {
    const secret = createTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(createTotpSecret()).not.toBe(secret);
  });

  it("accepts the current code and rejects a wrong one", async () => {
    const secret = createTotpSecret();
    const code = await generate({ secret });
    expect(await verifyTotp(secret, code)).toBe(true);
    expect(await verifyTotp(secret, "000000")).toBe(false);
  });

  it("accepts codes with spaces or dashes stripped", async () => {
    const secret = createTotpSecret();
    const code = await generate({ secret });
    expect(await verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  it("rejects malformed codes without hitting the verifier", async () => {
    const secret = createTotpSecret();
    expect(await verifyTotp(secret, "12345")).toBe(false);
    expect(await verifyTotp(secret, "abcdef")).toBe(false);
    expect(await verifyTotp(secret, "")).toBe(false);
  });

  it("builds an otpauth:// URI for authenticator apps", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "player@example.com");
    expect(uri.startsWith("otpauth://totp/GuitarHub:")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(decodeURIComponent(uri)).toContain("player@example.com");
  });
});

describe("recovery codes", () => {
  it("generates 10 unique codes in ABCDE-FGHJK form", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  it("normalizes case, whitespace and separators before hashing", () => {
    expect(normalizeRecoveryCode("  abcde fghjk ")).toBe("ABCDEFGHJK");
    expect(normalizeRecoveryCode("ABCDE-FGHJK")).toBe("ABCDEFGHJK");
    expect(hashRecoveryCode(" abcde fghjk ")).toBe(hashRecoveryCode("ABCDE-FGHJK"));
    expect(hashRecoveryCode("ABCDE-FGHJK")).toMatch(/^[0-9a-f]{64}$/);
  });
});
