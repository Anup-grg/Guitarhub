import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PedalsPage from "./page";

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

const pedals = [
  {
    id: "pedal_1",
    brand: "Line 6",
    model: "HX Stomp",
    slug: "line6-hx-stomp",
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    presetCount: 3,
  },
  {
    id: "pedal_2",
    brand: "Neural DSP",
    model: "Quad Cortex",
    slug: "neural-quad-cortex",
    validationMode: "CLOUD_LINK",
    extensions: [],
    presetCount: 0,
  },
];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/me")) {
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
    }
    return Promise.resolve(jsonResponse(200, { pedals }));
  });
});

describe("PedalsPage", () => {
  it("lists pedals with formats and preset counts", async () => {
    render(<PedalsPage />);

    expect(await screen.findByText("HX Stomp")).toBeTruthy();
    expect(screen.getByText("Line 6")).toBeTruthy();
    expect(screen.getByText(".hlx")).toBeTruthy();
    expect(screen.getByText(".hls")).toBeTruthy();
    expect(screen.getByText("3 presets")).toBeTruthy();
    expect(screen.getByText("Quad Cortex")).toBeTruthy();
    expect(screen.getByText("Cortex Cloud link")).toBeTruthy();
    expect(screen.getByRole("link", { name: /HX Stomp/ }).getAttribute("href")).toBe(
      "/pedals/line6-hx-stomp",
    );
  });

  it("shows an error when the catalog cannot be loaded", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(
        jsonResponse(500, { code: "INTERNAL", detail: "Database is on fire" }),
      );
    });

    render(<PedalsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Database is on fire");
  });

  it("shows an empty state when no pedals exist", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me")) {
        return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED" }));
      }
      return Promise.resolve(jsonResponse(200, { pedals: [] }));
    });

    render(<PedalsPage />);
    await waitFor(() => expect(screen.getByText("No pedals in the catalog yet.")).toBeTruthy());
  });
});
