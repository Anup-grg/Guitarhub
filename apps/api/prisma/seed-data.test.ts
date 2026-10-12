import { describe, expect, it } from "vitest";
import { pedals, tags } from "./seed-data.js";

const VALID_MODES = new Set(["DEEP_JSON", "SYSEX", "FIXED_BINARY", "SHALLOW", "CLOUD_LINK"]);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EXT_RE = /^[a-zA-Z0-9]+$/;

const REQUIRED_BRANDS = [
  "Line 6",
  "Fractal Audio",
  "Neural DSP",
  "Boss",
  "Flamma",
  "Zoom",
  "NUX",
  "Valeton",
];

describe("pedal catalog seed data", () => {
  it("covers every brand required by the SRS MVP matrix", () => {
    const brands = new Set(pedals.map((p) => p.brand));
    for (const brand of REQUIRED_BRANDS) {
      expect(brands).toContain(brand);
    }
  });

  it("has unique slugs", () => {
    const slugs = pedals.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has unique brand/model pairs", () => {
    const pairs = pedals.map((p) => `${p.brand}::${p.model}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("uses url-safe slugs", () => {
    for (const p of pedals) {
      expect(p.slug, p.slug).toMatch(SLUG_RE);
    }
  });

  it("only uses known validation modes", () => {
    for (const p of pedals) {
      expect(VALID_MODES.has(p.validationMode), `${p.slug}: ${p.validationMode}`).toBe(true);
    }
  });

  it("covers all five validation modes across the catalog", () => {
    const modes = new Set(pedals.map((p) => p.validationMode));
    expect(modes).toEqual(new Set(VALID_MODES));
  });

  it("gives cloud-link pedals no file extensions and all others at least one", () => {
    for (const p of pedals) {
      if (p.validationMode === "CLOUD_LINK") {
        expect(p.extensions, p.slug).toHaveLength(0);
      } else {
        expect(p.extensions.length, p.slug).toBeGreaterThan(0);
      }
    }
  });

  it("stores extensions without dots or path characters", () => {
    for (const p of pedals) {
      for (const ext of p.extensions) {
        expect(ext, `${p.slug}: ${ext}`).not.toMatch(/[.\\/]/);
        expect(ext, `${p.slug}: ${ext}`).toMatch(EXT_RE);
      }
    }
  });

  it("provides import instructions for every pedal", () => {
    for (const p of pedals) {
      expect(p.importInstructionsMd.trim().length, p.slug).toBeGreaterThan(20);
    }
  });

  it("provides brand and model for every pedal", () => {
    for (const p of pedals) {
      expect(p.brand.trim()).not.toBe("");
      expect(p.model.trim()).not.toBe("");
    }
  });

  it("uses positive size caps when provided", () => {
    for (const p of pedals) {
      if (p.maxPresetBytes !== undefined) expect(p.maxPresetBytes).toBeGreaterThan(0);
      if (p.maxBundleBytes !== undefined) expect(p.maxBundleBytes).toBeGreaterThan(0);
    }
  });
});

describe("tag seed data", () => {
  it("has unique slugs", () => {
    const slugs = tags.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses url-safe slugs", () => {
    for (const t of tags) {
      expect(t.slug, t.slug).toMatch(SLUG_RE);
    }
  });

  it("has non-empty labels", () => {
    for (const t of tags) {
      expect(t.label.trim()).not.toBe("");
    }
  });
});
