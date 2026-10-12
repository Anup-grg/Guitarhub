import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { createApp } from "../app.js";
import { fakePrisma } from "../test/fake-prisma.js";

const app = createApp();

function seedPedal(overrides: Record<string, unknown> = {}) {
  return fakePrisma.seed("pedal", {
    id: "pedal_1",
    brand: "Line 6",
    model: "HX Stomp",
    slug: "line6-hx-stomp",
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    ...overrides,
  });
}

beforeEach(() => {
  fakePrisma.reset();
});

describe("GET /api/v1/pedals", () => {
  it("returns enabled pedals with published preset counts", async () => {
    seedPedal();
    seedPedal({
      id: "pedal_2",
      model: "Helix",
      slug: "line6-helix",
    });
    fakePrisma.seed("preset", {
      id: "preset_1",
      userId: "u1",
      pedalId: "pedal_1",
      section: "GENERAL",
      title: "Chime",
      firmwareVersion: "3.70",
      status: "PUBLISHED",
    });
    fakePrisma.seed("preset", {
      id: "preset_2",
      userId: "u1",
      pedalId: "pedal_1",
      section: "GENERAL",
      title: "Draft",
      firmwareVersion: "3.70",
      status: "DRAFT",
    });

    const res = await request(app).get("/api/v1/pedals");
    expect(res.status).toBe(200);
    expect(res.body.pedals).toHaveLength(2);
    const stomp = res.body.pedals.find((p: { slug: string }) => p.slug === "line6-hx-stomp");
    expect(stomp).toMatchObject({
      brand: "Line 6",
      model: "HX Stomp",
      extensions: ["hlx", "hls"],
      validationMode: "DEEP_JSON",
      presetCount: 1,
    });
    expect(res.body.pedals[0].model).toBe("HX Stomp");
  });

  it("hides disabled pedals", async () => {
    seedPedal({ enabled: false });
    const res = await request(app).get("/api/v1/pedals");
    expect(res.status).toBe(200);
    expect(res.body.pedals).toEqual([]);
  });

  it("is public", async () => {
    seedPedal();
    const res = await request(app).get("/api/v1/pedals");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/pedals/:slug", () => {
  it("returns the full catalog entry including import instructions", async () => {
    seedPedal({
      importInstructionsMd: "1. Open HX Edit\n2. Import the file",
      firmwareNotes: "Runs 3.70+",
      maxPresetBytes: 1048576,
    });
    const res = await request(app).get("/api/v1/pedals/line6-hx-stomp");
    expect(res.status).toBe(200);
    expect(res.body.pedal).toMatchObject({
      slug: "line6-hx-stomp",
      importInstructionsMd: "1. Open HX Edit\n2. Import the file",
      firmwareNotes: "Runs 3.70+",
      maxPresetBytes: 1048576,
      presetCount: 0,
    });
  });

  it("404s unknown or disabled pedals", async () => {
    seedPedal({ enabled: false });
    expect((await request(app).get("/api/v1/pedals/line6-hx-stomp")).status).toBe(404);
    expect((await request(app).get("/api/v1/pedals/nope")).status).toBe(404);
  });
});
