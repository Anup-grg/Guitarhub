import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthNav from "./auth-nav";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const selfUser = {
  id: "u1",
  displayName: "Ada",
  email: "ada@example.com",
  emailVerified: true,
  links: [],
  role: "USER",
  verified: false,
  createdAt: new Date().toISOString(),
};

describe("AuthNav", () => {
  it("shows sign-in links for anonymous visitors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "UNAUTHORIZED" }));

    render(<AuthNav />);

    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(screen.getByText("Create account")).toBeTruthy();
  });

  it("shows the display name and signs out", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: selfUser }));
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });

    render(<AuthNav />);

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByText("Sign out")).toBeTruthy();

    await userEvent.click(screen.getByText("Sign out"));

    await waitFor(() => expect(screen.getByText("Sign in")).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/logout"))).toBe(true);
  });

  it("falls back to signed-out state when the lookup fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("boom"));

    render(<AuthNav />);

    expect(await screen.findByText("Sign in")).toBeTruthy();
  });

  it("links administrators to the admin console", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/me"))
        return Promise.resolve(jsonResponse(200, { user: { ...selfUser, role: "ADMIN" } }));
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });

    render(<AuthNav />);

    const adminLink = await screen.findByRole("link", { name: "Admin" });
    expect(adminLink.getAttribute("href")).toBe("/admin");
  });

  it("hides the admin link for non-administrators", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: selfUser }));
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });

    render(<AuthNav />);

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });
});
