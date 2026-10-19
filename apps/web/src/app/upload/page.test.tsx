import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UploadPage from "./page";

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

type Route = {
  method: string;
  path: string;
  handle: (init?: RequestInit) => Response;
};

function installRoutes(routes: Route[]): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    for (const route of routes) {
      if (method === route.method && String(url).includes(route.path)) {
        return Promise.resolve(route.handle(init));
      }
    }
    return Promise.resolve(
      jsonResponse(404, { code: "NOT_FOUND", detail: `no route for ${method} ${url}` }),
    );
  });
}

const user = { id: "u1", displayName: "Uploader" };

const filePedal = {
  id: "pedal_1",
  brand: "Line 6",
  model: "HX Stomp",
  slug: "line6-hx-stomp",
  validationMode: "DEEP_JSON",
  extensions: ["hlx", "hls"],
  presetCount: 0,
};

const cloudPedal = {
  id: "pedal_2",
  brand: "Neural DSP",
  model: "Quad Cortex",
  slug: "neural-quad-cortex",
  validationMode: "CLOUD_LINK",
  extensions: [],
  presetCount: 0,
};

function baseRoutes(): Route[] {
  return [
    { method: "GET", path: "/me", handle: () => jsonResponse(200, { user }) },
    { method: "GET", path: "/pedals", handle: () => jsonResponse(200, { pedals: [filePedal] }) },
  ];
}

const uploadSlot: Route = {
  method: "POST",
  path: "/presets/upload-url",
  handle: () =>
    jsonResponse(201, {
      uploadId: "up1",
      key: "quarantine/u1/abc/amb.hlx",
      url: "http://localhost:3000/api/v1/storage/local/upload/tok",
      headers: { "Content-Type": "application/octet-stream" },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      maxBytes: 1048576,
    }),
};

const storagePut: Route = {
  method: "PUT",
  path: "/storage/local/upload/",
  handle: () => jsonResponse(201, { ok: true, size: 100 }),
};

const inspectOk: Route = {
  method: "POST",
  path: "/presets/inspect",
  handle: () =>
    jsonResponse(200, {
      contentHash: "abc",
      size: 100,
      kind: "file",
      filename: "amb.hlx",
      extracted: { title: "Ambient Wash", device: "HX Stomp", firmwareVersion: "3.70" },
      duplicateOf: null,
    }),
};

async function pickPedalAndFile() {
  const pedalSelect = await screen.findByLabelText("Pedal");
  await userEvent.selectOptions(pedalSelect, "line6-hx-stomp");
  const input = screen.getByLabelText("Preset file");
  const file = new File(["{}"], "amb.hlx", { type: "application/octet-stream" });
  await userEvent.upload(input, file);
}

async function acceptLicense() {
  await userEvent.click(screen.getByRole("checkbox", { name: /my own work/i }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("UploadPage", () => {
  it("asks anonymous visitors to sign in", async () => {
    installRoutes([
      { method: "GET", path: "/me", handle: () => jsonResponse(401, { code: "UNAUTHORIZED" }) },
      { method: "GET", path: "/pedals", handle: () => jsonResponse(200, { pedals: [] }) },
    ]);

    render(<UploadPage />);
    expect(await screen.findByText(/Sign in to upload presets/)).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Sign in" })
        .some((a) => a.getAttribute("href") === "/login"),
    ).toBe(true);
  });

  it("publishes a validated preset end-to-end with prefilled metadata", async () => {
    installRoutes([
      ...baseRoutes(),
      uploadSlot,
      storagePut,
      inspectOk,
      {
        method: "POST",
        path: "/presets",
        handle: () =>
          jsonResponse(201, { preset: { id: "p1", title: "Ambient Wash", status: "published" } }),
      },
    ]);

    render(<UploadPage />);
    await pickPedalAndFile();

    expect(await screen.findByDisplayValue("Ambient Wash")).toBeTruthy();
    expect(screen.getByDisplayValue("3.70")).toBeTruthy();
    expect(screen.getByText(/amb\.hlx · 100 bytes/)).toBeTruthy();

    const publish = screen.getByRole("button", { name: "Publish" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText("Tags"), "clean");
    await acceptLicense();
    expect((publish as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(publish);

    expect(await screen.findByText(/is published/)).toBeTruthy();

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/presets") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      pedalSlug: "line6-hx-stomp",
      section: "general",
      title: "Ambient Wash",
      firmwareVersion: "3.70",
      kind: "file",
      licenseAttested: true,
      status: "published",
      files: [{ key: "quarantine/u1/abc/amb.hlx", role: "primary" }],
    });
  });

  it("surfaces validation failures from the inspect step", async () => {
    installRoutes([
      ...baseRoutes(),
      uploadSlot,
      storagePut,
      {
        method: "POST",
        path: "/presets/inspect",
        handle: () =>
          jsonResponse(400, {
            code: "FILE_JSON_INVALID",
            detail: "File is not valid JSON",
          }),
      },
    ]);

    render(<UploadPage />);
    await pickPedalAndFile();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("File is not valid JSON");
    expect(screen.queryByLabelText("Preset file")).toBeTruthy();
  });

  it("warns about duplicates and requires the fork acknowledgment", async () => {
    installRoutes([
      ...baseRoutes(),
      uploadSlot,
      storagePut,
      {
        method: "POST",
        path: "/presets/inspect",
        handle: () =>
          jsonResponse(200, {
            contentHash: "abc",
            size: 100,
            kind: "file",
            filename: "amb.hlx",
            extracted: { title: "Ambient Wash", firmwareVersion: "3.70" },
            duplicateOf: "preset_old",
          }),
      },
      {
        method: "POST",
        path: "/presets",
        handle: () =>
          jsonResponse(201, { preset: { id: "p2", title: "Ambient Wash", status: "published" } }),
      },
    ]);

    render(<UploadPage />);
    await pickPedalAndFile();

    expect(await screen.findByText(/identical published preset/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Tags"), "clean");
    await acceptLicense();
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /forked\/updated version/i }));
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("uses a Cortex Cloud link instead of a file for Quad Cortex", async () => {
    installRoutes([
      { method: "GET", path: "/me", handle: () => jsonResponse(200, { user }) },
      { method: "GET", path: "/pedals", handle: () => jsonResponse(200, { pedals: [cloudPedal] }) },
      {
        method: "POST",
        path: "/presets",
        handle: () =>
          jsonResponse(201, { preset: { id: "p3", title: "Cloud Lead", status: "published" } }),
      },
    ]);

    render(<UploadPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Pedal"), "neural-quad-cortex");

    expect(screen.queryByLabelText("Preset file")).toBeNull();
    expect(screen.getByLabelText("Cortex Cloud share URL")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Name"), "Cloud Lead");
    await userEvent.type(screen.getByLabelText("Firmware / editor version"), "CorOS 2.0.0");
    await userEvent.type(
      screen.getByLabelText("Cortex Cloud share URL"),
      "https://cloud.neuraldsp.com/presets/abc",
    );
    await userEvent.type(screen.getByLabelText("Tags"), "lead");
    await acceptLicense();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(screen.getByText(/is published/)).toBeTruthy());
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/presets") && (init as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      kind: "cloud_link",
      cloudUrl: "https://cloud.neuraldsp.com/presets/abc",
      tags: ["lead"],
    });
    expect(body.files).toEqual([]);
  });

  it("collects songs-section fields into the create request", async () => {
    installRoutes([
      ...baseRoutes(),
      uploadSlot,
      storagePut,
      inspectOk,
      {
        method: "POST",
        path: "/presets",
        handle: () => jsonResponse(201, { preset: { id: "p4", title: "Cover", status: "draft" } }),
      },
    ]);

    render(<UploadPage />);
    await pickPedalAndFile();
    await screen.findByDisplayValue("Ambient Wash");

    await userEvent.selectOptions(screen.getByLabelText("Section"), "songs");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Cover");
    await userEvent.type(screen.getByLabelText("Song title"), "Amazing Grace");
    await userEvent.type(screen.getByLabelText("Artist"), "Trad.");
    await userEvent.type(screen.getByLabelText(/Year/), "2020");
    await acceptLicense();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText(/saved as a draft/)).toBeTruthy();
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/presets") && (init as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      section: "songs",
      title: "Cover",
      songTitle: "Amazing Grace",
      artist: "Trad.",
      year: 2020,
      status: "draft",
    });
  });

  it("keeps Publish disabled until a general preset has a tag", async () => {
    installRoutes([
      ...baseRoutes(),
      uploadSlot,
      storagePut,
      inspectOk,
      {
        method: "POST",
        path: "/presets",
        handle: () =>
          jsonResponse(201, { preset: { id: "p5", title: "Ambient Wash", status: "published" } }),
      },
    ]);

    render(<UploadPage />);
    await pickPedalAndFile();
    await screen.findByDisplayValue("Ambient Wash");
    await acceptLicense();

    const publish = screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText("Tags"), "clean");
    expect(publish.disabled).toBe(false);
  });

  it("keeps Publish disabled until a songs preset has a song title and artist", async () => {
    installRoutes([
      ...baseRoutes(),
      uploadSlot,
      storagePut,
      inspectOk,
      {
        method: "POST",
        path: "/presets",
        handle: () => jsonResponse(201, { preset: { id: "p6", title: "Cover", status: "draft" } }),
      },
    ]);

    render(<UploadPage />);
    await pickPedalAndFile();
    await screen.findByDisplayValue("Ambient Wash");
    await userEvent.selectOptions(screen.getByLabelText("Section"), "songs");
    await acceptLicense();

    const publish = screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText("Song title"), "Amazing Grace");
    await userEvent.type(screen.getByLabelText("Artist"), "Trad.");
    expect(publish.disabled).toBe(false);
  });
});
