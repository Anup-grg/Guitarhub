import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const fetchMock = vi.fn();

const selfUser = {
  id: "u1",
  displayName: "Ada",
  bio: null,
  avatarUrl: null,
  email: "ada@example.com",
  emailVerified: true,
  pendingEmail: null,
  links: [],
  role: "USER",
  verified: false,
  totpEnabled: false,
  hasPassword: true,
  tosVersion: "1.0",
  bannedAt: null,
  createdAt: new Date().toISOString(),
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockSettings() {
  fetchMock.mockImplementation((input: unknown, init?: { method?: string }) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/me"))
      return Promise.resolve(jsonResponse(200, { user: selfUser, gear: [] }));
    if (url.endsWith("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [] }));
    if (url.endsWith("/sessions")) return Promise.resolve(jsonResponse(200, { sessions: [] }));
    throw new Error(`unexpected request ${method} ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("SettingsPage", () => {
  it("renders the tablist with a single selectable tab in the tab order", async () => {
    mockSettings();
    render(<SettingsPage />);

    const tablist = await screen.findByRole("tablist", { name: "Account settings" });
    expect(tablist).toBeTruthy();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Profile",
      "Security",
      "Sessions",
      "Danger zone",
    ]);
    expect(tabs[0]).toHaveProperty("tabIndex", 0);
    expect(tabs[0]).toHaveProperty("ariaSelected", "true");
    expect(tabs[1]).toHaveProperty("tabIndex", -1);

    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(`settings-tab-profile`);
  });

  it("moves selection and focus with the arrow keys and Home/End", async () => {
    mockSettings();
    render(<SettingsPage />);

    const tabs = await screen.findAllByRole("tab");
    await userEvent.click(tabs[0]);

    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveProperty("ariaSelected", "true");
    expect(tabs[1]).toHaveProperty("tabIndex", 0);
    expect(document.activeElement).toBe(tabs[1]);

    await userEvent.keyboard("{ArrowLeft}");
    expect(tabs[0]).toHaveProperty("ariaSelected", "true");

    await userEvent.keyboard("{End}");
    expect(tabs[3]).toHaveProperty("ariaSelected", "true");

    await userEvent.keyboard("{Home}");
    expect(tabs[0]).toHaveProperty("ariaSelected", "true");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("wraps around the ends of the tab list", async () => {
    mockSettings();
    render(<SettingsPage />);

    const tabs = await screen.findAllByRole("tab");
    await userEvent.click(tabs[0]);

    await userEvent.keyboard("{ArrowLeft}");
    expect(tabs[3]).toHaveProperty("ariaSelected", "true");

    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveProperty("ariaSelected", "true");
  });
});
