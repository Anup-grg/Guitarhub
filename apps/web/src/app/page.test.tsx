import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

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

const hotPreset = {
  id: "preset_hot",
  section: "general",
  title: "Crunchy Lead",
  descriptionMd: "classic rock",
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
  files: [],
  counts: { up: 4, down: 1, score: 3, comments: 2, downloads: 9, views: 20 },
};

const newPreset = {
  ...hotPreset,
  id: "preset_new",
  title: "Fresh Pad",
  pedal: { slug: "fractal-fm3", brand: "Fractal", model: "FM3" },
};

const pedal = { id: "pedal_1", brand: "Boss", model: "GT-1000", slug: "boss-gt1000", presetCount: 1 };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [pedal] }));
    if (url.includes("sort=hot")) {
      return Promise.resolve(jsonResponse(200, { presets: [hotPreset], nextCursor: null, total: 1 }));
    }
    return Promise.resolve(jsonResponse(200, { presets: [newPreset], nextCursor: null, total: 1 }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Home", () => {
  it("renders the GuitarHub brand and value proposition", async () => {
    render(<Home />);
    expect(screen.getByText("GuitarHub")).toBeTruthy();
    expect(screen.getByText(/Community preset sharing/)).toBeTruthy();
    expect(screen.getByText(/multi-effects pedals/)).toBeTruthy();
  });

  it("exposes browse, pedals and upload navigation", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: "Browse" }).getAttribute("href")).toBe("/presets");
    expect(screen.getByRole("link", { name: "Pedals" }).getAttribute("href")).toBe("/pedals");
    expect(screen.getByRole("link", { name: "Upload" }).getAttribute("href")).toBe("/upload");
  });

  it("shows trending and newest feeds from the API", async () => {
    render(<Home />);
    expect(await screen.findByText("Trending now")).toBeTruthy();
    expect(screen.getByText("Newest presets")).toBeTruthy();
    expect(screen.getByText("Crunchy Lead")).toBeTruthy();
    expect(screen.getByText("Fresh Pad")).toBeTruthy();
    expect(screen.getByText("Line 6 HX Stomp · ▲ 3")).toBeTruthy();
  });

  it("shows the pedal quick nav", async () => {
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Boss GT-1000/ })).toBeTruthy();
  });

  it("shows empty-feed messages and the search box on a fresh instance", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: [] }));
      return Promise.resolve(jsonResponse(200, { presets: [], nextCursor: null, total: 0 }));
    });
    render(<Home />);
    expect(
      await screen.findByText("Nothing trending yet — be the first to share."),
    ).toBeTruthy();
    expect(screen.getByText("No presets published yet.")).toBeTruthy();
    expect(screen.getByLabelText("Search presets")).toBeTruthy();
  });
});