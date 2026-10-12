import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { purgeDeletedAccounts, startPurgeJob } from "./purge-deleted.js";
import { fakePrisma } from "../test/fake-prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  fakePrisma.reset();
});

describe("purgeDeletedAccounts (FR-1.7)", () => {
  it("hard-deletes accounts whose soft deletion is older than 30 days", async () => {
    const now = new Date();
    fakePrisma.seed("user", {
      id: "old",
      email: "old@example.com",
      deletedAt: new Date(now.getTime() - 31 * DAY_MS),
    });
    fakePrisma.seed("user", {
      id: "fresh",
      email: "fresh@example.com",
      deletedAt: new Date(now.getTime() - 29 * DAY_MS),
    });
    fakePrisma.seed("user", { id: "active", email: "active@example.com", deletedAt: null });

    const count = await purgeDeletedAccounts(now);

    expect(count).toBe(1);
    expect(fakePrisma.tables.user.map((u) => u.id)).toEqual(["fresh", "active"]);
  });

  it("returns 0 when nothing is due", async () => {
    fakePrisma.seed("user", { id: "active", email: "a@example.com", deletedAt: null });

    expect(await purgeDeletedAccounts(new Date())).toBe(0);
    expect(fakePrisma.tables.user).toHaveLength(1);
  });

  it("treats the 30-day boundary itself as purgeable", async () => {
    const now = new Date();
    fakePrisma.seed("user", {
      id: "boundary",
      email: "b@example.com",
      deletedAt: new Date(now.getTime() - 30 * DAY_MS),
    });

    expect(await purgeDeletedAccounts(now)).toBe(1);
    expect(fakePrisma.tables.user).toHaveLength(0);
  });
});

describe("startPurgeJob", () => {
  it("schedules an unref'd daily timer", () => {
    const timer = startPurgeJob();
    expect(timer).toBeTruthy();
    expect(typeof timer.hasRef === "function" ? timer.hasRef() : false).toBe(false);
    clearInterval(timer);
  });
});
