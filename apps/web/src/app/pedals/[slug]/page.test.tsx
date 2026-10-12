import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PedalDetailPage from "./page";

const nav = vi.hoisted(() => ({ slug: "line6-hx-stomp" }));
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ slug: nav.slug }),
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
  extensions: ["hlx", "hls"],
  maxPresetBytes: 1048576,
  maxBundleBytes: 20971520,
  maxCompanionBytes: 5242880,
  presetCount: 3,
  firmwareNotes: "Runs 3.70+",
  importInstructionsMd: "1. Open HX Edit\n2. Import the file",
};

beforeEach(() => {
  nav.slug = "line6-hx-stomp";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/me")) {
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    }
    return Promise.resolve(jsonResponse(200, { pedal }));
  });
});

describe("PedalDetailPage", () => {
  it("renders formats, limits and import instructions", async () => {
    render(<PedalDetailPage />);

    expect(await screen.findByRole("heading", { name: "HX Stomp" })).toBeTruthy();
    expect(screen.getByText("Preset file upload")).toBeTruthy();
    expect(screen.getByText(".hlx, .hls")).toBeTruthy();
    expect(screen.getByText("1 MB")).toBeTruthy();
    expect(screen.getByText("5 MB")).toBeTruthy();
    expect(screen.getByText("Runs 3.70+")).toBeTruthy();
    expect(screen.getByText(/Open HX Edit/)).toBeTruthy();
    expect(screen.getByText("3 presets")).toBeTruthy();
  });

  it("links to the upload form preselected for this pedal", async () => {
    render(<PedalDetailPage />);
    const cta = await screen.findByRole("link", { name: /Upload a preset/ });
    expect(cta.getAttribute("href")).toBe("/upload?pedal=line6-hx-stomp");
  });

  it("shows a not-found state for unknown pedals", async () => {
    nav.slug = "nope";
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(jsonResponse(404, { code: "PEDAL_NOT_FOUND", detail: "No such pedal" }));
    });

    render(<PedalDetailPage />);
    expect(await screen.findByRole("heading", { name: "Pedal not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse the catalog" }).getAttribute("href")).toBe(
      "/pedals",
    );
  });

  it("lists community presets for the pedal", async () => {
    const communityPreset = {
      id: "preset_9",
      section: "general",
      title: "Ambient Wash",
      counts: { score: 3, downloads: 9 },
    };
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      if (String(url).includes("/presets?pedal=")) {
        return Promise.resolve(
          jsonResponse(200, { presets: [communityPreset], nextCursor: null, total: 1 }),
        );
      }
      return Promise.resolve(jsonResponse(200, { pedal }));
    });

    render(<PedalDetailPage />);
    expect(await screen.findByText("Community presets")).toBeTruthy();
    const link = await screen.findByRole("link", { name: /Ambient Wash/ });
    expect(link.getAttribute("href")).toBe("/presets/preset_9");
    expect(link.textContent).toContain("general · ▲ 3 · 9 downloads");
    expect(
      screen.getByRole("link", { name: /Browse all/ }).getAttribute("href"),
    ).toBe("/presets?pedal=line6-hx-stomp");
  });

  it("shows an empty message when the pedal has no presets yet", async () => {
    render(<PedalDetailPage />);
    expect(await screen.findByText("Community presets")).toBeTruthy();
    expect(await screen.findByText("No presets shared for this pedal yet.")).toBeTruthy();
  });
});
