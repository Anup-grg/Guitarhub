import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsSection } from "./sessions";

const fetchMock = vi.fn();

const now = new Date().toISOString();

const sessionRows = [
  {
    id: "sess-1",
    deviceName: "Chrome on Windows",
    ip: "192.168.1.10",
    current: true,
    createdAt: now,
  },
  {
    id: "sess-2",
    deviceName: "iPhone",
    ip: "10.0.0.5",
    current: false,
    createdAt: now,
  },
];

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function route() {
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/me/sessions") && method === "GET") {
      return Promise.resolve(jsonResponse(200, { sessions: sessionRows.map((s) => ({ ...s })) }));
    }
    if (path.endsWith("/me/sessions") && method === "DELETE") {
      return Promise.resolve(jsonResponse(204, null));
    }
    if (path.endsWith("/me/sessions/sess-2") && method === "DELETE") {
      sessionRows.splice(1, 1);
      return Promise.resolve(jsonResponse(204, null));
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sessionRows.splice(
    0,
    sessionRows.length,
    {
      id: "sess-1",
      deviceName: "Chrome on Windows",
      ip: "192.168.1.10",
      current: true,
      createdAt: now,
    },
    {
      id: "sess-2",
      deviceName: "iPhone",
      ip: "10.0.0.5",
      current: false,
      createdAt: now,
    },
  );
  route();
});

describe("SessionsSection", () => {
  it("lists sessions and marks the current device", async () => {
    render(<SessionsSection onSignedOutAll={() => {}} />);

    const list = await screen.findByRole("list");
    expect(list).toBeTruthy();
    expect(screen.getByText("Chrome on Windows")).toBeTruthy();
    expect(within(list).getByText("this device")).toBeTruthy();
    expect(screen.getByText("iPhone")).toBeTruthy();

    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(within(items[1]!).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("revokes another session and refreshes the list", async () => {
    render(<SessionsSection onSignedOutAll={() => {}} />);
    await screen.findByRole("list");

    const items = screen.getAllByRole("listitem");
    await userEvent.click(within(items[1]!).getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("Session signed out.")).toBeTruthy();
    expect(screen.queryByText("iPhone")).toBeNull();

    const deletes = fetchMock.mock.calls.filter(
      ([u, init]) => String(u).endsWith("/me/sessions/sess-2") && init?.method === "DELETE",
    );
    expect(deletes).toHaveLength(1);
  });

  it("signs out everywhere and reports back to the parent", async () => {
    const onSignedOutAll = vi.fn();
    render(<SessionsSection onSignedOutAll={onSignedOutAll} />);
    await screen.findByRole("list");

    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));

    await waitFor(() => expect(onSignedOutAll).toHaveBeenCalledTimes(1));
    const deleteAll = fetchMock.mock.calls.filter(
      ([u, init]) => String(u).endsWith("/me/sessions") && init?.method === "DELETE",
    );
    expect(deleteAll).toHaveLength(1);
  });

  it("shows a readable error when the list fails to load", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/me/sessions")) {
        return Promise.resolve(
          jsonResponse(503, { code: "UNAVAILABLE", detail: "Sessions are down" }),
        );
      }
      return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
    });

    render(<SessionsSection onSignedOutAll={() => {}} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Sessions are down")).toBeTruthy();
    expect(screen.queryByText("Loading sessions…")).toBeNull();
  });
});
