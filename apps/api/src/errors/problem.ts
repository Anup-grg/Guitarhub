import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function sendProblem(
  res: Response,
  status: number,
  code: string,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
): void {
  res.status(status).type("application/problem+json").send({
    type: "about:blank",
    title,
    status,
    code,
    ...(detail !== undefined ? { detail } : {}),
    ...extra,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  sendProblem(res, 404, "NOT_FOUND", "Not Found", `No route for ${req.method} ${req.path}`);
}

type HttpErrorLike = {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string;
};

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as HttpErrorLike;
  const status = e.status ?? e.statusCode;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    if (err.headers) {
      for (const [key, value] of Object.entries(err.headers)) res.set(key, value);
    }
    sendProblem(res, err.status, err.code, err.message, err.detail);
    return;
  }
  if (err instanceof ZodError) {
    sendProblem(res, 400, "VALIDATION_ERROR", "Validation failed", undefined, {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  const status = statusOf(err);
  if (status !== undefined && status >= 400 && status < 500) {
    const e = err as HttpErrorLike;
    const code = typeof e.code === "string" && e.code.length > 0 ? e.code : "BAD_REQUEST";
    sendProblem(res, status, code, "Bad Request", e.message);
    return;
  }
  sendProblem(res, 500, "INTERNAL_ERROR", "Internal Server Error");
}
