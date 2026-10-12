import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminOverviewPage, { formatBytes } from "./page";

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

const stats = {
  users: { total: 12, verified: 8, last30Days: 3 },
  presets: { total: 7, published: 5, draft: 1, hidden: 1, rejected: 0, quarantine: 0 },
  downloads: { total: 40, events: 25 },
  storage: { bytes: 2048, files: 2 },
  engagement: { comments: 4, votes: 9, openReports: 1 },
  perPedal: [{ pedalId: "pedal_helix", brand: "Line 6", model: "Helix", presets: 5, downloads: 40 }],
  recentSignups: [{ id: "u9", displayName: "Newbie", createdAt: new Date().toISOString() }],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    const path = String(url);
    if (path.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: admin }));
    if (path.endsWith("/admin/stats")) return Promise.resolve(jsonResponse(200, stats));
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
});

describe("formatBytes", () => {
  it("formats byte counts across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("AdminOverviewPage", () => {
  it("renders dashboard cards and the per-pedal table", async () => {
    render(<AdminOverviewPage />);

    expect(await screen.findByText("Users")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("Line 6 Helix")).toBeTruthy();
    expect(screen.getByText("Open reports")).toBeTruthy();
    expect(screen.getByText("Newbie", { exact: false })).toBeTruthy();
  });
});
