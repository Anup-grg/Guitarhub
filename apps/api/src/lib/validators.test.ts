import { describe, expect, it } from "vitest";
import {
  fileExt,
  isBundleExt,
  jsonNestingDepth,
  validateCloudLink,
  validatePresetFile,
  type PedalSpec,
} from "./validators.js";

const line6: PedalSpec = {
  brand: "Line 6",
  validationMode: "DEEP_JSON",
  extensions: ["hlx", "hls"],
  maxPresetBytes: 1024 * 1024,
  maxBundleBytes: 20 * 1024 * 1024,
  maxCompanionBytes: 5 * 1024 * 1024,
};

const fractal: PedalSpec = {
  ...line6,
  brand: "Fractal Audio",
  validationMode: "SYSEX",
  extensions: ["syx", "fasBundle"],
};

const valeton: PedalSpec = {
  ...line6,
  brand: "Valeton",
  validationMode: "FIXED_BINARY",
  extensions: ["prst"],
};

const flamma: PedalSpec = {
  ...line6,
  brand: "Flamma",
  validationMode: "SHALLOW",
  extensions: ["pfl"],
};

function hlx(name = "Crunch Box"): string {
  return JSON.stringify({
    schema: "L6Preset",
    version: 6,
    meta: {},
    data: { name, device: "HX Stomp", firmwareVersion: "3.70", amps: [] },
  });
}

describe("fileExt / isBundleExt", () => {
  it("extracts lowercase extensions", () => {
    expect(fileExt("Preset.HLX")).toBe("hlx");
    expect(fileExt("noext")).toBe("");
    expect(fileExt("trailing.")).toBe("");
  });

  it("recognizes bundle extensions case-insensitively", () => {
    expect(isBundleExt("hls")).toBe(true);
    expect(isBundleExt("fasBundle".toLowerCase())).toBe(true);
    expect(isBundleExt("hlx")).toBe(false);
  });
});

describe("jsonNestingDepth", () => {
  it("measures nesting and ignores braces inside strings", () => {
    expect(jsonNestingDepth('{"a":{"b":[1,2]}}')).toBe(3);
    expect(jsonNestingDepth('{"a":"}{"}')).toBe(1);
    expect(jsonNestingDepth('{"a":"\\\\\\""')).toBe(1);
  });
});

describe("validatePresetFile — DEEP_JSON", () => {
  it("accepts a well-formed preset and extracts metadata", () => {
    const result = validatePresetFile(
      line6,
      { filename: "crunch.hlx", role: "primary" },
      Buffer.from(hlx("Ambient Wash")),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extracted.title).toBe("Ambient Wash");
      expect(result.extracted.device).toBe("HX Stomp");
      expect(result.extracted.firmwareVersion).toBe("3.70");
    }
  });

  it("rejects malformed JSON", () => {
    const result = validatePresetFile(
      line6,
      { filename: "bad.hlx", role: "primary" },
      Buffer.from("{not json"),
    );
    expect(result).toMatchObject({ ok: false, code: "FILE_JSON_INVALID" });
  });

  it("rejects JSON without schema/data keys", () => {
    const result = validatePresetFile(
      line6,
      { filename: "odd.hlx", role: "primary" },
      Buffer.from(JSON.stringify({ hello: "world" })),
    );
    expect(result).toMatchObject({ ok: false, code: "FILE_SCHEMA_MISMATCH" });
  });

  it("rejects JSON nested beyond 64 levels before parsing", () => {
    let deep = '{"leaf":true}';
    for (let i = 0; i < 70; i++) deep = `{"n":${deep}}`;
    const result = validatePresetFile(line6, { filename: "deep.hlx", role: "primary" }, Buffer.from(deep));
    expect(result).toMatchObject({ ok: false, code: "FILE_JSON_TOO_DEEP" });
  });
});

describe("validatePresetFile — SYSEX", () => {
  const fractalBytes = Buffer.from([0xf0, 0x00, 0x01, 0x74, 0x01, 0x02, 0x03, 0xf7]);
  const zoomBytes = Buffer.from([0xf0, 0x52, 0x00, 0x10, 0x00, 0x01, 0x02, 0xf7]);

  it("accepts Fractal manufacturer magic", () => {
    expect(validatePresetFile(fractal, { filename: "amp.syx", role: "primary" }, fractalBytes).ok).toBe(true);
  });

  it("accepts Zoom manufacturer magic for Zoom pedals", () => {
    const zoom: PedalSpec = { ...fractal, brand: "Zoom" };
    expect(validatePresetFile(zoom, { filename: "patch.syx", role: "primary" }, zoomBytes).ok).toBe(true);
  });

  it("rejects wrong manufacturer for the pedal brand", () => {
    const result = validatePresetFile(
      fractal,
      { filename: "amp.syx", role: "primary" },
      zoomBytes,
    );
    expect(result).toMatchObject({ ok: false, code: "FILE_MAGIC_MISMATCH" });
  });

  it("rejects files not terminated with F7", () => {
    const broken = Buffer.from([0xf0, 0x00, 0x01, 0x74, 0x01, 0xf0, 0x00, 0x01]);
    expect(
      validatePresetFile(fractal, { filename: "amp.syx", role: "primary" }, broken),
    ).toMatchObject({ ok: false, code: "FILE_MAGIC_MISMATCH" });
  });
});

describe("validatePresetFile — FIXED_BINARY (Valeton)", () => {
  const good = Buffer.concat([
    Buffer.from("TSRP2-PG", "latin1"),
    Buffer.alloc(1224 - 8, 0x11),
  ]);

  it("accepts exactly 1224 bytes with TSRP + 2-PG header", () => {
    expect(good.length).toBe(1224);
    expect(validatePresetFile(valeton, { filename: "gp.prst", role: "primary" }, good).ok).toBe(true);
  });

  it("rejects the wrong size", () => {
    expect(
      validatePresetFile(valeton, { filename: "gp.prst", role: "primary" }, good.subarray(0, 100)),
    ).toMatchObject({ ok: false, code: "FILE_SIZE_EXCEEDED" });
  });

  it("rejects the wrong magic", () => {
    const bad = Buffer.concat([Buffer.from("XXXX2-PG", "latin1"), Buffer.alloc(1216, 0x11)]);
    expect(
      validatePresetFile(valeton, { filename: "gp.prst", role: "primary" }, bad),
    ).toMatchObject({ ok: false, code: "FILE_MAGIC_MISMATCH" });
  });
});

describe("validatePresetFile — SHALLOW and shared checks", () => {
  it("accepts arbitrary binary content for shallow pedals", () => {
    expect(
      validatePresetFile(flamma, { filename: "tone.pfl", role: "primary" }, Buffer.from("anything123")),
    ).toMatchObject({ ok: true });
  });

  it("rejects extensions outside the pedal allowlist", () => {
    expect(
      validatePresetFile(flamma, { filename: "evil.exe", role: "primary" }, Buffer.from("anything123")),
    ).toMatchObject({ ok: false, code: "FILE_EXTENSION_NOT_ALLOWED" });
  });

  it("rejects executables and archives masquerading as presets", () => {
    expect(
      validatePresetFile(flamma, { filename: "tone.pfl", role: "primary" }, Buffer.from("%PDF-1.7 blah")),
    ).toMatchObject({ ok: false, code: "FILE_MAGIC_MISMATCH" });
    expect(
      validatePresetFile(flamma, { filename: "tone.pfl", role: "primary" }, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])),
    ).toMatchObject({ ok: false, code: "FILE_MAGIC_MISMATCH" });
  });

  it("enforces size caps", () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 0x42);
    expect(
      validatePresetFile(flamma, { filename: "tone.pfl", role: "primary" }, big),
    ).toMatchObject({ ok: false, code: "FILE_SIZE_EXCEEDED" });
  });

  it("treats setlists as bundles with the larger cap", () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 0x42);
    expect(validatePresetFile(line6, { filename: "list.hls", role: "primary" }, big).ok).toBe(true);
  });
});

describe("validatePresetFile — companion IRs", () => {
  const wav = (() => {
    const head = Buffer.from("RIFF    WAVEfmt ");
    const body = Buffer.alloc(64, 0);
    return Buffer.concat([head, body]);
  })();

  it("accepts a RIFF/WAVE ir file", () => {
    expect(validatePresetFile(line6, { filename: "cab.wav", role: "ir" }, wav).ok).toBe(true);
  });

  it("rejects a non-wav companion", () => {
    expect(
      validatePresetFile(line6, { filename: "notes.txt", role: "ir" }, Buffer.from("hello")),
    ).toMatchObject({ ok: false, code: "FILE_EXTENSION_NOT_ALLOWED" });
  });

  it("rejects wav files without RIFF/WAVE headers", () => {
    expect(
      validatePresetFile(line6, { filename: "cab.wav", role: "ir" }, Buffer.from("not audio at all")),
    ).toMatchObject({ ok: false, code: "FILE_MAGIC_MISMATCH" });
  });
});

describe("validateCloudLink (FR-2.7)", () => {
  it("accepts an https cloud.neuraldsp.com URL", () => {
    const result = validateCloudLink("https://cloud.neuraldsp.com/presets/abc123");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.url).toContain("cloud.neuraldsp.com");
  });

  it.each([
    ["http://cloud.neuraldsp.com/x", "CLOUD_URL_INVALID"],
    ["https://evil.example/", "CLOUD_URL_HOST_NOT_ALLOWED"],
    ["https://cloud.neuraldsp.com.evil.example/", "CLOUD_URL_HOST_NOT_ALLOWED"],
    ["https://user@cloud.neuraldsp.com/", "CLOUD_URL_INVALID"],
    ["https://cloud.neuraldsp.com:8443/", "CLOUD_URL_INVALID"],
    ["not a url", "CLOUD_URL_INVALID"],
  ])("rejects %s", (url, code) => {
    expect(validateCloudLink(url)).toMatchObject({ ok: false, code });
  });
});
