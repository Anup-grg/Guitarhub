import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { logger } from "./logger.js";

/** OWASP ASVS L2 / SRS §6.1 argon2id parameters. */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

/** Used when the login target does not exist, so timing does not leak account existence. */
let dummyHash: string | undefined;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** Constant-cost failure path for unknown accounts. */
export async function burnPasswordTime(password: string): Promise<void> {
  dummyHash ??= await hashPassword("guitarhub-dummy-password-for-timing");
  await verifyPassword(dummyHash, password);
}

/**
 * Have I Been Pwned k-anonymity range query (SRS §6.1).
 * Fails open on network errors; never logs the password itself.
 */
export async function isBreachedPassword(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    const suffix = sha1.slice(5);
    for (const line of body.split("\n")) {
      const [tail, count] = line.split(":");
      if (tail === suffix && Number(count ?? 0) > 0) return true;
    }
    return false;
  } catch (err) {
    logger.warn({ err }, "hibp range check failed, failing open");
    return false;
  }
}
