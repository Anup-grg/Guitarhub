import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminGate from "./admin-gate";

const fetchMock = vi.fn();

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

function selfUser(role: string) {
  return {
    id: "u1",
    displayName: "Ada",
    email: "ada@example.com",
    emailVerified: true,
    links: [],
    role,
    verified: false,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("AdminGate", () => {
  it("prompts anonymous visitors to sign in and hides content", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "UNAUTHORIZED" }));
    render(
      <AdminGate title="Admin">
        <p>secret panel</p>
      </AdminGate>,
    );
    expect(await screen.findAllByText(/sign in/i)).toBeTruthy();
    expect(screen.queryByText("secret panel")).toBeNull();
  });

  it("blocks signed-in non-administrators", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith("/me")
        ? Promise.resolve(jsonResponse(200, { user: selfUser("USER") }))
        : Promise.resolve(jsonResponse(200, {})),
    );
    render(
      <AdminGate title="Admin">
        <p>secret panel</p>
      </AdminGate>,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("secret panel")).toBeNull();
  });

  it("renders the panel and admin nav for administrators", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith("/me")
        ? Promise.resolve(jsonResponse(200, { user: selfUser("ADMIN") }))
        : Promise.resolve(jsonResponse(200, {})),
    );
    render(
      <AdminGate title="Admin">
        <p>secret panel</p>
      </AdminGate>,
    );
    expect(await screen.findByText("secret panel")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Reports" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Pedals" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Tags" }).length).toBeGreaterThan(0);
  });
});
