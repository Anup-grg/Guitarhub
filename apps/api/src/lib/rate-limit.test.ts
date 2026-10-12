import { beforeEach, describe, expect, it } from "vitest";
import { checkRate, resetRateLimits } from "./rate-limit.js";

const RULE = { windowMs: 1000, max: 3 };

beforeEach(() => resetRateLimits());

describe("checkRate", () => {
  it("allows up to max attempts inside the window", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRate("key", RULE).allowed).toBe(true);
    }
    const blocked = checkRate("key", RULE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    checkRate("a", RULE);
    checkRate("a", RULE);
    expect(checkRate("a", RULE).allowed).toBe(true);
    expect(checkRate("b", RULE).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    let now = 0;
    expect(checkRate("key", RULE, now).allowed).toBe(true);
    expect(checkRate("key", RULE, now).allowed).toBe(true);
    expect(checkRate("key", RULE, now).allowed).toBe(true);
    expect(checkRate("key", RULE, now).allowed).toBe(false);
    now = RULE.windowMs + 1;
    expect(checkRate("key", RULE, now).allowed).toBe(true);
  });
});
