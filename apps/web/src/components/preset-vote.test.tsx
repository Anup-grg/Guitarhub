import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PresetVote from "./preset-vote";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const apiMock = vi.hoisted(() => ({ votePreset: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, votePreset: apiMock.votePreset };
});

const defaults = {
  presetId: "preset_1",
  score: 3,
  up: 4,
  down: 1,
  userVote: 0,
  mine: false,
  signedIn: true,
};

beforeEach(() => {
  apiMock.votePreset.mockReset();
});

describe("PresetVote", () => {
  it("casts an upvote and refreshes the visible score", async () => {
    apiMock.votePreset.mockResolvedValue({
      counts: { up: 5, down: 1, score: 4 },
      userVote: 1,
    });
    render(<PresetVote {...defaults} />);
    fireEvent.click(screen.getByRole("button", { name: "Upvote" }));

    await screen.findByTestId("vote-score");
    expect(apiMock.votePreset).toHaveBeenCalledWith("preset_1", 1);
    await screen.findByText("4");
    expect(screen.getByText(/5 up · 1 down/)).toBeTruthy();
  });

  it("toggles back to zero when the active vote is re-clicked", async () => {
    apiMock.votePreset.mockResolvedValue({
      counts: { up: 4, down: 1, score: 3 },
      userVote: 0,
    });
    render(<PresetVote {...defaults} userVote={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Upvote" }));
    await screen.findByText("3");
    expect(apiMock.votePreset).toHaveBeenCalledWith("preset_1", 0);
  });

  it("asks signed-out visitors to sign in", () => {
    apiMock.votePreset.mockRejectedValue({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Not authenticated",
      issues: [],
    });
    render(<PresetVote {...defaults} signedIn={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Upvote" }));
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });

  it("prevents voting on your own preset", () => {
    render(<PresetVote {...defaults} mine />);
    expect(screen.getByRole("button", { name: "Upvote" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/own preset/)).toBeTruthy();
  });
});