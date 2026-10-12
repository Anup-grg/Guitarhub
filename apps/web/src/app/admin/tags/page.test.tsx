import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminTagsPage from "./page";

const fetchMock = vi.fn();
const state = { blacklisted: false };

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

function tag(id: string, slug: string, label: string, blacklisted = false) {
  return { id, slug, label, blacklisted, presetCount: 2 };
}

beforeEach(() => {
  state.blacklisted = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : {};
    if (path.endsWith("/me")) return Promise.resolve(jsonResponse(200, { user: admin }));
    if (path.endsWith("/admin/tags") && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, {
          tags: [tag("t1", "crunch", "Crunch", state.blacklisted), tag("t2", "lead", "Lead")],
        }),
      );
    }
    if (path.endsWith("/admin/tags") && method === "POST") {
      return Promise.resolve(
        jsonResponse(201, {
          tag: { id: "t9", slug: body.slug, label: body.label, blacklisted: false, presetCount: 0 },
        }),
      );
    }
    if (path.endsWith("/admin/tags/t1") && method === "PATCH") {
      if (body.blacklisted === true) {
        state.blacklisted = true;
        return Promise.resolve(
          jsonResponse(200, { tag: tag("t1", "crunch", "Crunch", true), detached: 2 }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, {
          tag: {
            id: "t1",
            slug: body.slug ?? "crunch",
            label: body.label ?? "Crunch",
            blacklisted: state.blacklisted,
          },
          detached: 0,
        }),
      );
    }
    if (path.endsWith("/admin/tags/t1/merge") && method === "POST") {
      return Promise.resolve(
        jsonResponse(200, { merged: { sourceSlug: "crunch", targetSlug: "lead", moved: 2 } }),
      );
    }
    return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND" }));
  });
});

describe("AdminTagsPage", () => {
  it("lists tags with counts", async () => {
    render(<AdminTagsPage />);
    expect(await screen.findByText("Crunch")).toBeTruthy();
    expect(screen.getByText("Lead")).toBeTruthy();
    expect(screen.getAllByText(/2 presets/).length).toBeGreaterThan(0);
  });

  it("blacklists a tag and reports detachments", async () => {
    render(<AdminTagsPage />);
    await screen.findByText("Crunch");

    await userEvent.click(screen.getAllByRole("button", { name: "Blacklist" })[0]);

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.getByText(/detached from 2 preset/)).toBeTruthy();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/tags/t1") && (init as { method?: string })?.method === "PATCH",
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({ blacklisted: true });
  });

  it("merges a tag into another", async () => {
    render(<AdminTagsPage />);
    await screen.findByText("Crunch");

    await userEvent.click(screen.getAllByRole("button", { name: "Merge" })[0]);
    await userEvent.selectOptions(screen.getByLabelText("Target tag"), "t2");
    await userEvent.click(screen.getByRole("button", { name: "Confirm merge" }));

    await waitFor(() => expect(screen.getByText(/Merged/)).toBeTruthy());
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/admin/tags/t1/merge"));
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({ targetTagId: "t2" });
  });

  it("renames a tag through the inline editor", async () => {
    render(<AdminTagsPage />);
    await screen.findByText("Crunch");

    await userEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const labelInput = screen.getAllByLabelText("Label")[1];
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, "Crunchy");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Renamed to/)).toBeTruthy();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/tags/t1") && (init as { method?: string })?.method === "PATCH",
    );
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({
      slug: "crunch",
      label: "Crunchy",
    });
  });

  it("creates a tag from the form", async () => {
    render(<AdminTagsPage />);
    await screen.findByText("Crunch");

    await userEvent.type(screen.getByLabelText("Slug"), "shoegaze");
    await userEvent.type(screen.getByLabelText("Label"), "Shoegaze");
    await userEvent.click(screen.getByRole("button", { name: "Create tag" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText(/Created/)).toBeTruthy();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/tags") && (init as { method?: string })?.method === "POST",
    );
    expect(JSON.parse(String((call![1] as { body: string }).body))).toMatchObject({
      slug: "shoegaze",
      label: "Shoegaze",
    });
  });

  it("hides the blacklist action for an already-blacklisted tag", async () => {
    state.blacklisted = true;
    render(<AdminTagsPage />);
    await screen.findByText("Crunch");

    expect(screen.getByText("blacklisted")).toBeTruthy();
    // Only the still-legit "Lead" tag offers a blacklist action.
    expect(screen.getAllByRole("button", { name: "Blacklist" })).toHaveLength(1);
  });
});
