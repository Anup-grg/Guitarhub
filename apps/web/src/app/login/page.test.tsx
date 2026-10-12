import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const push = vi.fn();
const refresh = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
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
  push.mockReset();
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/me")) {
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    }
    return Promise.resolve(jsonResponse(401, { code: "INVALID_CREDENTIALS", detail: "Email or password is incorrect" }));
  });
});

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "wrong-password-123");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage", () => {
  it("renders the sign-in form", async () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("Continue with Google")).toBeTruthy();
    expect(screen.getByText("Continue with GitHub")).toBeTruthy();
  });

  it("shows the API error for bad credentials", async () => {
    render(<LoginPage />);
    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Email or password is incorrect")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("asks for a two-factor code when the API demands one", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(
        jsonResponse(403, { code: "TWO_FACTOR_REQUIRED", detail: "Enter your two-factor code" }),
      );
    });

    render(<LoginPage />);
    await fillAndSubmit();

    expect(await screen.findByLabelText("Two-factor code")).toBeTruthy();

    // Second submit carries the code and signs in.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(jsonResponse(200, { user: { id: "u1" } }));
    });
    await userEvent.type(screen.getByLabelText("Two-factor code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const loginCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/login"),
    );
    expect(loginCalls.at(-1)?.[1]?.body).toContain('"totp":"123456"');
  });
});
