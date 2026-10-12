import { ApiError } from "./api";

export type AttemptResult =
  | { ok: true }
  | { ok: false; stepUp: true }
  | { ok: false; stepUp: false; error: string };

/**
 * Runs a write operation and classifies failures: step-up re-authentication is
 * reported separately so the caller can prompt for the password and retry.
 */
export async function attempt(run: () => Promise<void>): Promise<AttemptResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.code === "STEP_UP_REQUIRED") {
      return { ok: false, stepUp: true };
    }
    return {
      ok: false,
      stepUp: false,
      error: err instanceof ApiError ? err.message : "Something went wrong — please try again.",
    };
  }
}
