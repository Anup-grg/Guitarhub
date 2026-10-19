import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { fakePrisma } from "../test/fake-prisma.js";
import {
  HOT_EPOCH_MS,
  HOT_HALF_LIFE_SEC,
  hotScore,
  refreshAllHotRank,
  refreshPresetHotRank,
} from "./hot-rank.js";

describe("hotScore (SRS FR-4.3)", () => {
  it("ranks higher-voted presets above lower-voted ones at the same age", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const high = hotScore(100, base);
    const mid = hotScore(10, base);
    const zero = hotScore(0, base);
    const negative = hotScore(-10, base);
    expect(high).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(zero);
    expect(zero).toBeGreaterThan(negative);
  });

  it("ranks newer presets above older ones with the same score", () => {
    const old = new Date("2020-06-01T00:00:00Z");
    const newer = new Date("2021-01-01T00:00:00Z");
    const newest = new Date("2022-01-01T00:00:00Z");
    expect(hotScore(5, newest)).toBeGreaterThan(hotScore(5, newer));
    expect(hotScore(5, newer)).toBeGreaterThan(hotScore(5, old));
  });

  it("is deterministic and accepts Date objects or ISO strings", () => {
    const created = new Date("2023-07-15T12:00:00Z");
    expect(hotScore(42, created)).toBe(hotScore(42, created));
    expect(hotScore(42, created)).toBe(hotScore(42, created.toISOString()));
  });

  it("adds one time unit per elapsed half-life for a score of 1", () => {
    const epoch = new Date(HOT_EPOCH_MS);
    const oneHalfLifeAfter = new Date(HOT_EPOCH_MS + HOT_HALF_LIFE_SEC * 1000);
    expect(hotScore(1, epoch)).toBeCloseTo(0, 6); // log10(1) + time term 0
    expect(hotScore(1, oneHalfLifeAfter)).toBeCloseTo(1, 6);
    expect(hotScore(-1, oneHalfLifeAfter)).toBeCloseTo(-1, 6);
  });
});

function seedFixtures() {
  fakePrisma.seed("user", { id: "u_alice", email: "alice@example.com", displayName: "Alice" });
  fakePrisma.seed("user", { id: "u_bob", email: "bob@example.com", displayName: "Bob" });
  fakePrisma.seed("preset", {
    id: "p_hot",
    userId: "u_alice",
    pedalId: "pedal_line6",
    status: "PUBLISHED",
    title: "Hot one",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  fakePrisma.seed("preset", {
    id: "p_draft",
    userId: "u_alice",
    pedalId: "pedal_line6",
    status: "DRAFT",
    title: "Hidden",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  });
  fakePrisma.seed("vote", { userId: "u_alice", presetId: "p_hot", value: 1 });
  fakePrisma.seed("vote", { userId: "u_bob", presetId: "p_hot", value: 1 });
  fakePrisma.seed("vote", { userId: "u_bob", presetId: "p_draft", value: 1 });
}

describe("refreshPresetHotRank", () => {
  beforeEach(() => {
    fakePrisma.reset();
    seedFixtures();
  });

  it("stores the up-down tally for a single preset", async () => {
    const rank = await refreshPresetHotRank("p_hot");
    const preset = fakePrisma.tables.preset.find((p) => p.id === "p_hot");
    expect(rank).toBe(preset?.hotRank);
    expect(rank).toBe(hotScore(2, new Date("2026-01-01T00:00:00Z")));
  });

  it("returns 0 for a missing preset", async () => {
    await expect(refreshPresetHotRank("p_missing")).resolves.toBe(0);
  });
});

describe("refreshAllHotRank (SRS §7.3.4 worker)", () => {
  beforeEach(() => {
    fakePrisma.reset();
    seedFixtures();
    fakePrisma.seed("preset", {
      id: "p_old",
      userId: "u_alice",
      pedalId: "pedal_line6",
      status: "PUBLISHED",
      title: "Oldie",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      hotRank: -999,
    });
  });

  it("recomputes every published preset and leaves drafts alone", async () => {
    const updated = await refreshAllHotRank();
    expect(updated).toBe(2); // p_hot + p_old

    const hot = fakePrisma.tables.preset.find((p) => p.id === "p_hot");
    const old = fakePrisma.tables.preset.find((p) => p.id === "p_old");
    const draft = fakePrisma.tables.preset.find((p) => p.id === "p_draft");
    expect(hot?.hotRank).toBe(hotScore(2, new Date("2026-01-01T00:00:00Z")));
    expect(old?.hotRank).toBe(hotScore(0, new Date("2024-01-01T00:00:00Z")));
    expect(draft?.hotRank).toBe(0); // untouched (draft default)
  });
});
