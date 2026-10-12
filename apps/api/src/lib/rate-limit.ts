/**
 * Small fixed-window in-memory rate limiter (SRS NFR-6 / §6.7).
 * Per-process only — the reverse proxy enforces the IP-level limits in front of us.
 */
import { ApiError } from "../errors/problem.js";

export type RateLimitRule = { windowMs: number; max: number };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; retryAfterSec: number; remaining: number };

export function checkRate(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSec: 0, remaining: rule.max - 1 };
  }
  if (existing.count >= rule.max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSec: 0, remaining: rule.max - existing.count };
}

/** Clears all buckets — used by tests. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Throws the canonical `429 RATE_LIMITED` problem (RFC 6585) for a denied
 * check, always advertising `Retry-After`. `never` return lets callers use it
 * as a guard clause.
 */
export function rateLimited(
  result: RateLimitResult,
  message = "Too many requests — try again shortly",
): never {
  throw new ApiError(429, "RATE_LIMITED", message, `Retry in ${result.retryAfterSec}s`, {
    "Retry-After": String(result.retryAfterSec),
  });
}
