import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerifyEmailPage from "./page";

const state = vi.hoisted(() => ({ params: "token=verify-token-abc123" }));
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.params),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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
  emailVerified: false,
  links: [],
  role: "USER",
  verified: false,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  state.params = "token=verify-token-abc123";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("VerifyEmailPage", () => {
  it("confirms a token on arrival", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const path = String(url);
      if (path.endsWith("/auth/verify-email") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(200, { ok: true, user: { ...selfUser, emailVerified: true } }),
        );
      }
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    });

    render(<VerifyEmailPage />);

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText(/Your email address is confirmed/)).toBeTruthy();
    const verify = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/auth/verify-email"))!;
    expect(JSON.parse(String(verify[1].body))).toEqual({ token: "verify-token-abc123" });
  });

  it("shows an error and a fresh-link escape hatch for bad tokens", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (String(url).endsWith("/auth/verify-email") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(400, {
            code: "INVALID_OR_EXPIRED_TOKEN",
            detail: "This verification link is invalid or expired",
          }),
        );
      }
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    });

    render(<VerifyEmailPage />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/invalid or expired/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Request a fresh link/ })).toBeTruthy();
  });

  it("offers a resend button for signed-in users when no token was supplied", async () => {
    state.params = "";
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(200, { user: selfUser }));
      }
      return Promise.resolve(jsonResponse(202, { status: "accepted" }));
    });

    render(<VerifyEmailPage />);

    expect(await screen.findByText(/we sent you a confirmation link/i)).toBeTruthy();
    const resend = await screen.findByRole("button", { name: "Resend confirmation email" });
    await userEvent.click(resend);

    expect(await screen.findByText("Confirmation email sent again.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/verify-email/resend"))).toBe(
      true,
    );
  });

  it("points signed-out visitors at the sign-in page", async () => {
    state.params = "";
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" })),
    );

    render(<VerifyEmailPage />);

    expect(await screen.findByText(/to request a new confirmation email/)).toBeTruthy();
    const signInLinks = screen.getAllByRole("link", { name: "Sign in" });
    expect(signInLinks.length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Resend confirmation email" })).toBeNull();
  });
});
