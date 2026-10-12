import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./page";

const state = vi.hoisted(() => ({ params: "token=reset-token-abc123" }));
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

function route(resetResponse: () => Response) {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/me")) {
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    }
    if (String(url).endsWith("/auth/password/reset")) {
      return Promise.resolve(resetResponse());
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
}

beforeEach(() => {
  state.params = "token=reset-token-abc123";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  route(() => jsonResponse(200, { ok: true }));
});

async function submit(password: string, confirm = password) {
  await userEvent.type(screen.getByLabelText("New password"), password);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
}

describe("ResetPasswordPage", () => {
  it("asks for a new password twice", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm new password")).toBeTruthy();
  });

  it("rejects mismatched passwords without calling the API", async () => {
    render(<ResetPasswordPage />);
    await submit("first-passphrase-1", "second-passphrase-2");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("The two passwords do not match.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/password/reset"))).toBe(false);
  });

  it("posts the token and new password, then offers the sign-in link", async () => {
    render(<ResetPasswordPage />);
    await submit("brand-new-passphrase-9");

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(
      screen.getByText(/Your password has been changed and every device was signed out/),
    ).toBeTruthy();
    const resetCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/password/reset"),
    )!;
    expect(JSON.parse(String(resetCall[1].body))).toEqual({
      token: "reset-token-abc123",
      password: "brand-new-passphrase-9",
    });
    expect(screen.getByRole("link", { name: /Sign in with your new password/ })).toBeTruthy();
  });

  it("reports expired links", async () => {
    route(() =>
      jsonResponse(400, {
        code: "INVALID_OR_EXPIRED_TOKEN",
        detail: "This reset link is invalid or expired",
      }),
    );

    render(<ResetPasswordPage />);
    await submit("brand-new-passphrase-9");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("This reset link is invalid or expired")).toBeTruthy();
  });

  it("explains when the token is missing entirely", () => {
    state.params = "";
    render(<ResetPasswordPage />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/missing its token/)).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).endsWith("/auth/password/reset")),
    ).toBe(false);
  });
});
