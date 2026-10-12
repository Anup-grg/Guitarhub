import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { attempt } from "./step-up";

describe("attempt", () => {
  it("reports success when the call resolves", async () => {
    const result = await attempt(async () => undefined);
    expect(result).toEqual({ ok: true });
  });

  it("classifies a step-up requirement separately", async () => {
    const result = await attempt(async () => {
      throw new ApiError(403, "STEP_UP_REQUIRED", "Confirm your identity");
    });
    expect(result).toEqual({ ok: false, stepUp: true });
  });

  it("surfaces ordinary API errors with their message", async () => {
    const result = await attempt(async () => {
      throw new ApiError(409, "EMAIL_TAKEN", "That email is already registered");
    });
    expect(result).toEqual({
      ok: false,
      stepUp: false,
      error: "That email is already registered",
    });
  });

  it("wraps non-ApiError failures", async () => {
    const result = await attempt(async () => {
      throw new TypeError("boom");
    });
    expect(result).toEqual({
      ok: false,
      stepUp: false,
      error: "Something went wrong — please try again.",
    });
  });
});
