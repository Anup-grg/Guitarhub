import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { fakePrisma } from "../test/fake-prisma.js";

const app = createApp();

beforeEach(() => {
  fakePrisma.reset();
});

describe("GET /api/v1/tags", () => {
  it("lists all tags sorted by label without authentication", async () => {
    fakePrisma.seed("tag", { id: "tag_2", slug: "worship", label: "Worship" });
    fakePrisma.seed("tag", { id: "tag_1", slug: "crunch", label: "Crunch" });

    const res = await request(app).get("/api/v1/tags");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tags: [
        { id: "tag_1", slug: "crunch", label: "Crunch" },
        { id: "tag_2", slug: "worship", label: "Worship" },
      ],
    });
  });

  it("returns an empty list when no tags exist", async () => {
    const res = await request(app).get("/api/v1/tags");
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([]);
  });

  it("hides blacklisted tags from the public list (FR-7.4)", async () => {
    fakePrisma.seed("tag", { id: "tag_ok", slug: "crunch", label: "Crunch" });
    fakePrisma.seed("tag", { id: "tag_bad", slug: "abuse", label: "Abuse", blacklisted: true });

    const res = await request(app).get("/api/v1/tags");
    expect(res.status).toBe(200);
    expect(res.body.tags.map((t: { slug: string }) => t.slug)).toEqual(["crunch"]);
  });
});
