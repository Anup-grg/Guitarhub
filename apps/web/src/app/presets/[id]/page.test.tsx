import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PresetDetailPage from "./page";

const nav = vi.hoisted(() => ({ id: "preset_1" }));
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: nav.id }),
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

const detail = {
  id: "preset_1",
  section: "songs",
  title: "Amazing Grace",
  descriptionMd: "Ambient take on an old hymn.",
  songTitle: "Amazing Grace",
  artist: "Trad.",
  album: null,
  year: null,
  firmwareVersion: "3.70",
  kind: "file",
  cloudUrl: null,
  usesThirdPartyIr: true,
  version: 1,
  status: "published",
  contentHash: "abc",
  fileSize: 131072,
  fileExt: "hlx",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  pedal: {
    slug: "line6-hx-stomp",
    brand: "Line 6",
    model: "HX Stomp",
    importInstructionsMd: "1. Open HX Edit\n2. Import",
  },
  user: { id: "u1", displayName: "AxeHandler", verified: true },
  tags: [{ slug: "worship", label: "Worship" }],
  files: [
    { role: "primary", size: 131072, ext: "hlx", contentHash: "abcdef1234567890" },
  ],
  counts: { up: 4, down: 1, score: 3, comments: 2, downloads: 9, views: 20 },
  firmwareWarning: "This preset targets firmware 3.70 but your HX Stomp is running 3.50.",
  userVote: 0,
  mine: false,
};

beforeEach(() => {
  nav.id = "preset_1";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/me")) {
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    }
    if (url.includes("/presets/preset_1/comments")) {
      return Promise.resolve(jsonResponse(200, { comments: [], nextCursor: null, total: 0 }));
    }
    if (url.includes("/presets/preset_1")) {
      return Promise.resolve(jsonResponse(200, { preset: detail }));
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
});

describe("PresetDetailPage", () => {
  it("renders full preset metadata", async () => {
    render(<PresetDetailPage />);
    expect(await screen.findByRole("heading", { name: "Amazing Grace" })).toBeTruthy();
    expect(screen.getByText(/by AxeHandler \(verified\)/)).toBeTruthy();
    expect(screen.getByText("3.70")).toBeTruthy();
    expect(screen.getByText("128 KB")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText(/4 up · 1 down/)).toBeTruthy();
    expect(screen.getByTestId("vote-score").textContent).toBe("3");
    expect(screen.getByText(/Ambient take on an old hymn/)).toBeTruthy();
    const songLine = screen.getByText(
  (content: string, el: Element | null) => el?.tagName === "P" && content.includes("Song:"),
);
expect(songLine.textContent).toBe("Song: Amazing Grace — Trad.");
    expect(screen.getByText(/How to import/)).toBeTruthy();
  });

  it("warns about firmware and third-party IRs", async () => {
    render(<PresetDetailPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("targets firmware 3.70");
    expect(screen.getByRole("note").textContent).toContain("third-party IRs");
  });

  it("provides a download action", async () => {
    render(<PresetDetailPage />);
    const button = await screen.findByRole("button", { name: "Download preset" });
    expect(button).toBeTruthy();
  });

  it("shows a not-found state", async () => {
    nav.id = "missing";
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(404, { code: "PRESET_NOT_FOUND", detail: "No such preset" })),
    );
    render(<PresetDetailPage />);
    expect(await screen.findByRole("heading", { name: "Preset not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse presets" }).getAttribute("href")).toBe("/presets");
  });
});