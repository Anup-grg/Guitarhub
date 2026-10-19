import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./page";

const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/me")) {
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    }
    return Promise.resolve(jsonResponse(202, { status: "accepted" }));
  });
});

describe("ForgotPasswordPage", () => {
  it("keeps the uniform response even for unknown accounts", async () => {
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText("Email"), "ghost@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText(/If an account exists for that address/)).toBeTruthy();
    expect(screen.getByText("ghost@example.com")).toBeTruthy();

    const forgot = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/password/forgot"));
    expect(forgot?.[1]?.body).toBe('{"email":"ghost@example.com"}');
  });

  it("surfaces rate limits and other API failures", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(
        jsonResponse(429, { code: "RATE_LIMITED", detail: "Too many requests" }),
      );
    });

    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Too many requests")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
  });
});
