import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, getCurrentUser } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api", () => {
  it("performs JSON requests against /api/v1 and returns the payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const result = await api<{ ok: boolean }>("/health");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/health");
    expect(init.method).toBe("GET");
  });

  it("serialises bodies as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await api("/auth/login", { method: "POST", body: { email: "a@b.c" } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"email":"a@b.c"}');
  });

  it("turns problem+json errors into ApiError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        status: 401,
        code: "INVALID_CREDENTIALS",
        title: "Unauthorized",
        detail: "Email or password is incorrect",
      }),
    );

    const err = (await api("/auth/login", { method: "POST", body: {} }).catch(
      (e) => e,
    )) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(err.message).toBe("Email or password is incorrect");
  });

  it("keeps field issues", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        status: 400,
        code: "VALIDATION_FAILED",
        detail: "Check the form",
        issues: [{ path: "password", message: "Too short" }],
      }),
    );

    const err = (await api("/auth/register", { method: "POST", body: {} }).catch(
      (e) => e,
    )) as ApiError;

    expect(err.issues).toEqual([{ path: "password", message: "Too short" }]);
  });

  it("wraps network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const err = (await api("/health").catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("NETWORK");
  });
});

describe("getCurrentUser", () => {
  it("returns the user when authenticated", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: "u1", displayName: "Ada" } }));

    const user = await getCurrentUser();

    expect(user).toMatchObject({ id: "u1", displayName: "Ada" });
  });

  it("returns null when the API answers 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "UNAUTHORIZED", detail: "Sign in" }));

    expect(await getCurrentUser()).toBeNull();
  });
});
