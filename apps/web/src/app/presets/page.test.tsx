import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PresetsPage from "./page";

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

const pedal = {
  id: "pedal_1",
  brand: "Line 6",
  model: "HX Stomp",
  slug: "line6-hx-stomp",
  validationMode: "DEEP_JSON",
  extensions: ["hlx"],
  presetCount: 1,
};

const preset = {
  id: "preset_1",
  section: "general",
  title: "Crunchy Lead",
  descriptionMd: "classic rock tones",
  songTitle: null,
  artist: null,
  album: null,
  year: null,
  firmwareVersion: "3.70",
  kind: "file",
  cloudUrl: null,
  usesThirdPartyIr: false,
  version: 1,
  status: "published",
  contentHash: "abc",
  fileSize: 128,
  fileExt: "hlx",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  pedal: { slug: "line6-hx-stomp", brand: "Line 6", model: "HX Stomp" },
  user: { id: "u1", displayName: "AxeHandler", verified: true },
  tags: [{ slug: "crunch", label: "Crunch" }],
  files: [{ role: "primary", size: 128, ext: "hlx", contentHash: "abc" }],
  counts: { up: 4, down: 1, score: 3, comments: 2, downloads: 9, views: 20 },
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [pedal] }));
    if (url.includes("/presets")) {
      return Promise.resolve(jsonResponse(200, { presets: [preset], nextCursor: null, total: 1 }));
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
});

describe("PresetsPage", () => {
  it("lists matching presets with creator and counts", async () => {
    render(<PresetsPage />);
    expect(await screen.findByText("Crunchy Lead")).toBeTruthy();
    const cardLink = screen.getByRole("link", { name: /Crunchy Lead/ });
    expect(cardLink.textContent).toContain("Line 6 HX Stomp");
    expect(screen.getByText("1 preset")).toBeTruthy();
    expect(screen.getByText(/by AxeHandler/)).toBeTruthy();
    expect(screen.getByText(/▲ 3 · 2 comments · 9 downloads/)).toBeTruthy();
    expect(cardLink.getAttribute("href")).toBe("/presets/preset_1");
  });

  it("shows an empty state when nothing matches", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [pedal] }));
      return Promise.resolve(jsonResponse(200, { presets: [], nextCursor: null, total: 0 }));
    });
    render(<PresetsPage />);
    expect(await screen.findByText(/No presets match your filters/)).toBeTruthy();
  });

  it("re-runs the search when a filter changes", async () => {
    const user = userEvent.setup();
    render(<PresetsPage />);
    await screen.findByText("Crunchy Lead");

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [pedal] }));
      if (url.includes("section=songs")) {
        return Promise.resolve(jsonResponse(200, { presets: [], nextCursor: null, total: 0 }));
      }
      return Promise.resolve(jsonResponse(200, { presets: [preset], nextCursor: null, total: 1 }));
    });

    await user.selectOptions(screen.getByLabelText("Section"), "songs");
    expect(await screen.findByText(/No presets match your filters/)).toBeTruthy();
  });

  it("appends the next page when Load more is clicked", async () => {
    const user = userEvent.setup();
    const pageTwo = { ...preset, id: "preset_2", title: "Second Preset" };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [pedal] }));
      if (url.includes("cursor=")) {
        return Promise.resolve(
          jsonResponse(200, { presets: [pageTwo], nextCursor: null, total: 2 }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, { presets: [preset], nextCursor: "cursor_1", total: 2 }),
      );
    });

    render(<PresetsPage />);
    await screen.findByText("Crunchy Lead");
    expect(screen.getByText("2 presets")).toBeTruthy();
    const more = screen.getByRole("button", { name: "Load more presets" });

    await user.click(more);
    expect(await screen.findByText("Second Preset")).toBeTruthy();
    expect(screen.getByText("Crunchy Lead")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more presets" })).toBeNull();
  });

  it("does not get stuck loading when the search query is unchanged", async () => {
    const user = userEvent.setup();
    render(<PresetsPage />);
    await screen.findByText("Crunchy Lead");

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.queryByText(/Loading presets/)).toBeNull();
    expect(screen.getByText("Crunchy Lead")).toBeTruthy();
  });
});
