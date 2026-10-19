import type { Request, RequestHandler } from "express";
import { ApiError } from "../errors/problem.js";
import { isHardBanned } from "../lib/users.js";

/**
 * SRS §3.1 / FR-7 — administration endpoints are restricted to `ADMIN` accounts.
 * Assumes `attachUser` has run; unauthenticated callers get 401, non-admins 403.
 */
export const requireAdmin: RequestHandler = (req: Request, _res, next) => {
  if (!req.auth) {
    next(new ApiError(401, "UNAUTHORIZED", "Sign in to continue"));
    return;
  }
  if (isHardBanned(req.auth.user)) {
    next(new ApiError(403, "ACCOUNT_BANNED", "This account is suspended"));
    return;
  }
  if (req.auth.user.role !== "ADMIN") {
    next(new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required"));
    return;
  }
  next();
};
