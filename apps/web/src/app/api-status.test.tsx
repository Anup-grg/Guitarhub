import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApiStatus from "./api-status";

function statusText(): string | undefined {
  return screen.getByTestId("api-status").textContent ?? undefined;
}

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function fetchReturning(body: unknown) {
  return stubFetch(() => Promise.resolve({ json: () => Promise.resolve(body) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiStatus", () => {
  it("shows checking state before the health response arrives", () => {
    stubFetch(() => new Promise(() => {}));
    render(<ApiStatus />);
    expect(statusText()).toContain("checking");
  });

  it("shows ok and db state when the API is healthy", async () => {
    fetchReturning({ status: "ok", service: "guitarhub-api", db: "up", time: "now" });
    render(<ApiStatus />);
    await waitFor(() => expect(statusText()).toContain("API: ok"));
    expect(statusText()).toContain("db up");
  });

  it("shows degraded when the API responds but the database is down", async () => {
    fetchReturning({ status: "degraded", service: "guitarhub-api", db: "down", time: "now" });
    render(<ApiStatus />);
    await waitFor(() => expect(statusText()).toContain("API: degraded"));
    expect(statusText()).toContain("db down");
  });

  it("shows unreachable when the fetch fails", async () => {
    stubFetch(() => Promise.reject(new Error("network down")));
    render(<ApiStatus />);
    await waitFor(() => expect(statusText()).toContain("API: unreachable"));
    expect(statusText()).not.toContain("db");
  });

  it("requests the health endpoint through the proxy path", async () => {
    const fetchFn = fetchReturning({ status: "ok", db: "up" });
    render(<ApiStatus />);
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith("/api/v1/health"));
  });
});
