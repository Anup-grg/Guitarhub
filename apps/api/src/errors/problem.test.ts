import type { NextFunction, Request, Response } from "express";
import { ZodError, z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { ApiError, errorHandler, notFoundHandler, sendProblem } from "./problem.js";

function mockRes() {
  const res = {
    headersSent: false,
    status: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    type: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

const req = { method: "GET", path: "/api/v1/thing" } as unknown as Request;
const next = vi.fn() as NextFunction;

describe("ApiError", () => {
  it("carries status, code, message and optional detail", () => {
    const err = new ApiError(409, "DUPLICATE_PRESET", "Already exists", "hash abc");
    expect(err.status).toBe(409);
    expect(err.code).toBe("DUPLICATE_PRESET");
    expect(err.message).toBe("Already exists");
    expect(err.detail).toBe("hash abc");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("sendProblem", () => {
  it("sets status, problem+json content type and body", () => {
    const res = mockRes();
    sendProblem(res, 429, "RATE_LIMITED", "Too Many Requests", "try later");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.type).toHaveBeenCalledWith("application/problem+json");
    expect(res.send).toHaveBeenCalledWith({
      type: "about:blank",
      title: "Too Many Requests",
      status: 429,
      code: "RATE_LIMITED",
      detail: "try later",
    });
  });

  it("omits detail when not provided", () => {
    const res = mockRes();
    sendProblem(res, 404, "NOT_FOUND", "Not Found");
    expect(res.send).toHaveBeenCalledWith({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
    });
  });
});

describe("notFoundHandler", () => {
  it("responds 404 with the method and path in detail", () => {
    const res = mockRes();
    notFoundHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.detail).toBe("No route for GET /api/v1/thing");
  });
});

describe("errorHandler", () => {
  it("passes ApiError through unchanged", () => {
    const res = mockRes();
    errorHandler(new ApiError(403, "FORBIDDEN", "No access"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.code).toBe("FORBIDDEN");
    expect(body.title).toBe("No access");
  });

  it("converts ZodError to 400 with field issues", () => {
    const res = mockRes();
    const schema = z.object({ email: z.string().email() });
    let zerr: ZodError | undefined;
    try {
      schema.parse({ email: "nope" });
    } catch (e) {
      zerr = e as ZodError;
    }
    errorHandler(zerr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.send.mock.calls[0]?.[0] as {
      code: string;
      issues: { path: string; message: string }[];
    };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.issues[0]?.path).toBe("email");
    expect(body.issues[0]?.message).toBeTruthy();
  });

  it("preserves 4xx status and error code", () => {
    const res = mockRes();
    errorHandler({ status: 429, code: "RATE_LIMITED", message: "slow down" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.detail).toBe("slow down");
  });

  it("falls back to BAD_REQUEST for 4xx without a code", () => {
    const res = mockRes();
    errorHandler({ statusCode: 413, message: "payload too large" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    const body = res.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.code).toBe("BAD_REQUEST");
  });

  it("maps unknown errors to 500 without leaking the message", () => {
    const res = mockRes();
    errorHandler(new Error("secret internal detail"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });

  it("maps non-numeric statuses to 500", () => {
    const res = mockRes();
    errorHandler({ status: "weird" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("delegates to next() when headers were already sent", () => {
    const res = mockRes();
    res.headersSent = true;
    const err = new Error("late failure");
    errorHandler(err, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.send).not.toHaveBeenCalled();
  });
});
