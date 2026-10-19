import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";

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
    return Promise.resolve(jsonResponse(201, { user: { id: "u1", displayName: "New" } }));
  });
});

async function fillForm() {
  await userEvent.type(screen.getByLabelText("Display name"), "New Player");
  await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "long-enough-passphrase");
}

const registerCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/register"));

describe("RegisterPage", () => {
  it("renders the registration form with policy links", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("Terms of Service")).toBeTruthy();
    expect(screen.getByText("Community Guidelines")).toBeTruthy();
  });

  it("refuses to submit until both policy checkboxes are accepted", async () => {
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(/accept the Terms of Service and Community Guidelines/i),
    ).toBeTruthy();
    expect(registerCalls()).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("submits the form with the accepted policy versions", async () => {
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByLabelText(/^I accept the Terms of Service$/));
    await userEvent.click(screen.getByLabelText(/^I accept the Community Guidelines$/));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/verify-email"));
    const call = registerCalls()[0]!;
    const body = JSON.parse(String(call[1].body));
    expect(body).toMatchObject({
      email: "new@example.com",
      displayName: "New Player",
      tosVersion: "1.0",
      acceptTerms: true,
      acceptGuidelines: true,
      rememberMe: true,
    });
  });

  it("shows the API error when the email is taken", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(
        jsonResponse(409, {
          code: "EMAIL_TAKEN",
          detail: "That email is already registered",
        }),
      );
    });

    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByLabelText(/^I accept the Terms of Service$/));
    await userEvent.click(screen.getByLabelText(/^I accept the Community Guidelines$/));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("That email is already registered")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
