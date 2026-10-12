import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GearItem, SelfUser } from "@/lib/api";
import { ProfileSection } from "./profile";

const fetchMock = vi.fn();

const user: SelfUser = {
  id: "u1",
  displayName: "Ada",
  avatarUrl: null,
  bio: null,
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

const stompGear: GearItem = {
  pedalId: "pedal_stomp",
  firmwareVersion: "3.50",
  pedal: { id: "pedal_stomp", brand: "Line 6", model: "HX Stomp", slug: "line6-hx-stomp" },
};

const catalog = [
  { id: "pedal_stomp", brand: "Line 6", model: "HX Stomp", slug: "line6-hx-stomp", validationMode: "DEEP_JSON", extensions: [".hlx"], presetCount: 1 },
  { id: "pedal_helix", brand: "Line 6", model: "Helix LT", slug: "line6-helix-lt", validationMode: "DEEP_JSON", extensions: [".hlx"], presetCount: 0 },
];

/** Routes GET /pedals + GET /me (gear) and lets the final PATCH be scripted. */
function mockApi(baseGear: GearItem[], patch?: () => Response) {
  fetchMock.mockImplementation((input: unknown, init?: { method?: string }) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/pedals")) return Promise.resolve(jsonResponse(200, { pedals: catalog }));
    if (url.endsWith("/me") && method === "GET") return Promise.resolve(jsonResponse(200, { user, gear: baseGear }));
    if (url.endsWith("/me") && method === "PATCH") {
      return Promise.resolve(patch ? patch() : jsonResponse(200, { user, gear: baseGear }));
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
  return fetchMock;
}

function patchCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ProfileSection", () => {
  it("saves without a password when the step-up window is fresh", async () => {
    mockApi([], () => jsonResponse(200, { user, gear: [] }));
    const onChange = vi.fn();

    render(<ProfileSection user={user} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("Profile saved.")).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(user);
    const patch = patchCalls()[0]!;
    expect(String(patch[0])).toContain("/me");
    expect(patch[1].method).toBe("PATCH");
    expect(JSON.parse(String(patch[1].body)).password).toBeUndefined();
  });

  it("prompts for a password after STEP_UP_REQUIRED and retries with it", async () => {
    let saves = 0;
    mockApi([], () => {
      saves += 1;
      return saves === 1
        ? jsonResponse(403, { code: "STEP_UP_REQUIRED", detail: "Confirm your identity" })
        : jsonResponse(200, { user, gear: [] });
    });
    const onChange = vi.fn();

    render(<ProfileSection user={user} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    const prompt = await screen.findByText(/Confirm it's you/);
    expect(prompt).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(user));
    expect(screen.getByText("Profile saved.")).toBeTruthy();

    const [first, second] = patchCalls();
    expect(JSON.parse(String(first![1].body)).password).toBeUndefined();
    expect(JSON.parse(String(second![1].body)).password).toBe("correct horse battery");
  });

  it("cancelling the prompt returns to the plain save button", async () => {
    mockApi([], () => jsonResponse(403, { code: "STEP_UP_REQUIRED", detail: "Confirm your identity" }));

    render(<ProfileSection user={user} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await screen.findByText(/Confirm it's you/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText(/Confirm it's you/)).toBeNull());
    expect(screen.getByRole("button", { name: "Save profile" })).toBeTruthy();
  });

  it("surfaces ordinary API errors", async () => {
    mockApi([], () =>
      jsonResponse(409, { code: "EMAIL_TAKEN", detail: "That email is already registered" }),
    );

    render(<ProfileSection user={user} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("That email is already registered")).toBeTruthy();
    expect(screen.queryByText("Profile saved.")).toBeNull();
  });

  it("loads saved gear and persists firmware edits", async () => {
    mockApi([stompGear]);
    const onChange = vi.fn();

    render(<ProfileSection user={user} onChange={onChange} />);
    const firmware = await screen.findByLabelText("Line 6 HX Stomp firmware version");
    expect(firmware).toHaveProperty("value", "3.50");

    await userEvent.clear(firmware);
    await userEvent.type(firmware, "3.71");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByRole("status");

    expect(onChange).toHaveBeenCalled();
    const patchBody = JSON.parse(String(patchCalls()[0]![1].body));
    expect(patchBody.gear).toEqual([{ pedalId: "pedal_stomp", firmwareVersion: "3.71" }]);
  });

  it("adds a pedal from the catalog and includes it on save", async () => {
    mockApi([]);

    render(<ProfileSection user={user} onChange={vi.fn()} />);
    const pedal = await screen.findByLabelText("Add a pedal");
    await userEvent.selectOptions(pedal, "pedal_helix");
    await userEvent.type(screen.getByLabelText("Firmware version"), "3.15");
    await userEvent.click(screen.getByRole("button", { name: "Add to gear" }));

    expect(screen.getByRole("button", { name: "Remove Line 6 Helix LT from gear" })).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByRole("status");

    const patchBody = JSON.parse(String(patchCalls()[0]![1].body));
    expect(patchBody.gear).toEqual([{ pedalId: "pedal_helix", firmwareVersion: "3.15" }]);
  });

  it("removes gear from the list before saving", async () => {
    mockApi([stompGear]);

    render(<ProfileSection user={user} onChange={vi.fn()} />);
    const remove = await screen.findByRole("button", { name: "Remove Line 6 HX Stomp from gear" });
    await userEvent.click(remove);
    expect(
      screen.queryByRole("button", { name: "Remove Line 6 HX Stomp from gear" }),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByRole("status");

    const patchBody = JSON.parse(String(patchCalls()[0]![1].body));
    expect(patchBody.gear).toEqual([]);
  });
});
