import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminReportsPage from "./page";

const fetchMock = vi.fn();
const state = { resolved: false, banned: false };

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

const admin = {
  id: "a1",
  displayName: "Admin",
  email: "admin@example.com",
  emailVerified: true,
  links: [],
  role: "ADMIN",
  verified: true,
  createdAt: new Date().toISOString(),
};

const openReport = {
  id: "rep1",
  targetType: "preset",
  targetId: "preset1",
  reason: "spam spam spam",
  status: "open",
  resolutionNote: null,
  handledAt: null,
  createdAt: new Date().toISOString(),
  reporter: { id: "r1", displayName: "Reporter" },
  target: {
    type: "preset",
    id: "preset1",
    title: "Sus preset",
    status: "published",
    owner: { id: "owner1", displayName: "Bob" },
  },
};

function counts() {
  return { open: state.resolved ? 0 : 1, resolved: state.resolved ? 1 : 0, dismissed: 1 };
}

/** Serves the report list for whichever `?status=` the page asked for. */
function pageFor(path: string) {
  const status = new URLSearchParams(path.split("?")[1] ?? "").get("status") ?? "open";
  const base = { page: 1, limit: 20, counts: counts() };
  if (status === "open" && !state.resolved) return { ...base, reports: [openReport], total: 1 };
  return { ...base, reports: [], total: 0 };
}

beforeEach(() => {
  state.resolved = false;
  state.banned = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: admin }));
    if (path.endsWith("/resolve") && method === "POST") {
      state.resolved = true;
      return Promise.resolve(
        jsonResponse(200, { report: { id: "rep1", status: "resolved", action: "remove" } }),
      );
    }
    if (path.endsWith("/ban") && method === "POST") {
      state.banned = true;
      return Promise.resolve(jsonResponse(200, { user: { id: "owner1", banned: true } }));
    }
    if (path.includes("/admin/reports")) {
      return Promise.resolve(jsonResponse(200, pageFor(path)));
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
});

describe("AdminReportsPage", () => {
  it("lists open reports with enriched target details", async () => {
    render(<AdminReportsPage />);
    expect(await screen.findByText("Sus preset")).toBeTruthy();
    expect(screen.getByText(/spam spam spam/)).toBeTruthy();
    expect(screen.getByText(/Reported by Reporter/)).toBeTruthy();
  });

  it("resolves a report by removing the content", async () => {
    render(<AdminReportsPage />);
    await screen.findByText("Sus preset");

    await userEvent.type(screen.getByLabelText("Moderator note"), "illegal content");
    await userEvent.click(screen.getByRole("button", { name: "Remove content" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Report removed.");
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/admin/reports/rep1/resolve"),
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call![1].body))).toMatchObject({
      action: "remove",
      note: "illegal content",
    });
  });

  it("bans the reported content owner", async () => {
    render(<AdminReportsPage />);
    await screen.findByText("Sus preset");

    await userEvent.click(screen.getByRole("button", { name: "Ban Bob" }));

    await waitFor(() => expect(state.banned).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/admin/users/owner1/ban"),
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call![1].body))).toMatchObject({ type: "hard" });
  });

  it("switches status tabs and shows the empty state for that filter", async () => {
    render(<AdminReportsPage />);
    await screen.findByText("Sus preset");

    await userEvent.click(screen.getByRole("button", { name: /^resolved/ }));

    expect(await screen.findByText("No resolved reports.")).toBeTruthy();
    expect(screen.queryByText("Sus preset")).toBeNull();
  });

  it("surfaces an API error when a report was already handled", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: admin }));
      if (path.endsWith("/resolve") && method === "POST") {
        return Promise.resolve(
          jsonResponse(409, {
            code: "REPORT_ALREADY_HANDLED",
            detail: "This report has already been handled",
          }),
        );
      }
      if (path.includes("/admin/reports")) return Promise.resolve(jsonResponse(200, pageFor(path)));
      return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
    });

    render(<AdminReportsPage />);
    await screen.findByText("Sus preset");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/REPORT_ALREADY_HANDLED/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
