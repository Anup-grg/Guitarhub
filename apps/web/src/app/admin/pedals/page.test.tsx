import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPedalsPage from "./page";

const fetchMock = vi.fn();
const state = { enabled: true };

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

function pedal() {
  return {
    id: "pedal_1",
    brand: "Line 6",
    model: "HX Stomp",
    slug: "line-6-hx-stomp",
    aliases: [],
    extensions: [".hlx"],
    validationMode: "DEEP_JSON",
    firmwareNotes: null,
    importInstructionsMd: "",
    maxPresetBytes: 1048576,
    maxBundleBytes: 20971520,
    maxCompanionBytes: 5242880,
    enabled: state.enabled,
    presetCount: 3,
  };
}

beforeEach(() => {
  state.enabled = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: admin }));
    if (path.endsWith("/admin/pedals") && method === "GET") {
      return Promise.resolve(jsonResponse(200, { pedals: [pedal()] }));
    }
    if (path.endsWith("/admin/pedals") && method === "POST") {
      const body = JSON.parse(String(init!.body));
      return Promise.resolve(jsonResponse(201, { pedal: { ...pedal(), id: "pedal_new", ...body } }));
    }
    if (path.endsWith("/admin/pedals/pedal_1") && method === "PATCH") {
      const body = JSON.parse(String(init!.body));
      if (body.enabled !== undefined) state.enabled = body.enabled;
      return Promise.resolve(jsonResponse(200, { pedal: pedal() }));
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
});

describe("AdminPedalsPage", () => {
  it("lists the catalog", async () => {
    render(<AdminPedalsPage />);
    expect(await screen.findByText(/HX Stomp/)).toBeTruthy();
    expect(screen.getByText(/3 published/)).toBeTruthy();
  });

  it("disables a pedal", async () => {
    render(<AdminPedalsPage />);
    await screen.findByText(/HX Stomp/);

    await userEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(state.enabled).toBe(false));
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/pedals/pedal_1") && (init as { method?: string })?.method === "PATCH",
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({ enabled: false });
  });

  it("creates a pedal from the form", async () => {
    render(<AdminPedalsPage />);
    await screen.findByText(/HX Stomp/);

    await userEvent.type(screen.getByLabelText("Brand"), "Boss");
    await userEvent.type(screen.getByLabelText("Model"), "GT-1000");
    await userEvent.type(screen.getByLabelText("Extensions"), ".tsl");
    await userEvent.click(screen.getByRole("button", { name: "Create pedal" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/pedals") && (init as { method?: string })?.method === "POST",
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({
      brand: "Boss",
      model: "GT-1000",
      extensions: [".tsl"],
    });
  });

  it("enables a disabled pedal", async () => {
    state.enabled = false;
    render(<AdminPedalsPage />);
    await screen.findByText(/HX Stomp/);

    await userEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(state.enabled).toBe(true));
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/pedals/pedal_1") && (init as { method?: string })?.method === "PATCH",
    );
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({ enabled: true });
  });

  it("edits an existing pedal through the inline row", async () => {
    render(<AdminPedalsPage />);
    await screen.findByText(/HX Stomp/);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const modelInput = screen.getAllByLabelText("Model")[1];
    await userEvent.clear(modelInput);
    await userEvent.type(modelInput, "HX Stomp XL");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/admin/pedals/pedal_1") && (init as { method?: string })?.method === "PATCH",
        ),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/pedals/pedal_1") && (init as { method?: string })?.method === "PATCH",
    );
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({ model: "HX Stomp XL" });
  });
});
