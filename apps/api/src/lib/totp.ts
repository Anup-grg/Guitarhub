import { generateSecret, generateURI, verify } from "otplib";
import { randomBytes } from "node:crypto";
import { hashToken } from "./tokens.js";

export const TOTP_ISSUER = "GuitarHub";

export function createTotpSecret(): string {
  return generateSecret({ length: 20 });
}

/** RFC 6238 verification with ±30 s transmission window. */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const token = code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verify({ secret, token, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

/** `otpauth://` URI for the authenticator-app QR code. */
export function totpUri(secret: string, account: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: account, secret });
}

/** 10 single-use recovery codes, shown once and stored hashed (SRS §6.3). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 5 bytes -> 8 chars base32-ish, grouped for readability: abcd-efgh
    const raw = randomBytes(5).toString("hex").slice(0, 10).toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  // Strip case, whitespace and separators so "abcde fghjk" and "ABCDE-FGHJK" hash alike.
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return hashToken(normalizeRecoveryCode(code));
}
