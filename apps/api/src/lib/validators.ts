/**
 * Server-side preset file validation (SRS FR-2.4, §2.1, Appendix A).
 *
 * Validation order: extension allowlist → size cap → structural/magic checks
 * per the pedal's validation mode. Nothing here parses untrusted content beyond
 * what the mode allows; XML is never parsed (NFR-5).
 */

export type PedalSpec = {
  brand: string;
  validationMode: string;
  extensions: string[];
  maxPresetBytes: number;
  maxBundleBytes: number;
  maxCompanionBytes: number;
};

export type FileRoleInput = "primary" | "ir";

export type ExtractedMeta = {
  title?: string;
  device?: string;
  firmwareVersion?: string;
};

export type ValidationResult =
  { ok: true; extracted: ExtractedMeta } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ValidationResult => ({ ok: false, code, message });
const pass = (extracted: ExtractedMeta = {}): ValidationResult => ({ ok: true, extracted });

/** Extensions that hold many presets and are accepted as "bundle" kind. */
export const BUNDLE_EXTENSIONS = new Set(["hls", "hss", "hxb", "fasbundle", "tsl"]);

/** Companion (IR) extensions accepted regardless of pedal. */
export const IR_EXTENSIONS = new Set(["wav", "hir", "syx"]);

export function fileExt(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

export function isBundleExt(ext: string): boolean {
  return BUNDLE_EXTENSIONS.has(ext.toLowerCase());
}

const MASQUERADE: [string, string][] = [
  ["%PDF-", "%pdf-"],
  ["ELF", "\x7felf"],
  ["ZIP", "pk\x03\x04"],
  ["gzip", "\x1f\x8b"],
  ["<html", "<html"],
  ["<!doctype", "<!doctype"],
];

function startsWithLatin1(head: string, sig: string): boolean {
  return head.startsWith(sig);
}

/** Cheap rejection of executables/archives pretending to be presets (NFR-5). */
function rejectMasquerade(bytes: Buffer): ValidationResult | null {
  const head = bytes.subarray(0, 16).toString("latin1").toLowerCase();
  for (const [name, sig] of MASQUERADE) {
    if (startsWithLatin1(head, sig)) {
      return fail(
        "FILE_MAGIC_MISMATCH",
        `File contents look like a ${name} file, not a preset — re-export from the editor`,
      );
    }
  }
  return null;
}

/** Depth of the outermost JSON value without parsing (FR-2.4 cap: 64). */
export function jsonNestingDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    }
  }
  return max;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function deepJsonCheck(bytes: Buffer): ValidationResult {
  const text = bytes.toString("utf8");
  if (jsonNestingDepth(text) > 64) {
    return fail("FILE_JSON_TOO_DEEP", "Preset JSON is nested deeper than 64 levels");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("FILE_JSON_INVALID", "Preset file is not valid JSON — re-export it and try again");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("FILE_JSON_INVALID", "Preset JSON must be an object at the top level");
  }
  const obj = parsed as Record<string, unknown>;
  const hasSchema = typeof obj.schema === "string" && obj.schema.length > 0;
  const hasData = typeof obj.data === "object" && obj.data !== null;
  if (!hasSchema && !hasData) {
    return fail(
      "FILE_SCHEMA_MISMATCH",
      "JSON parsed but does not look like a Line 6 preset (missing schema/data keys)",
    );
  }
  const data = (typeof obj.data === "object" && obj.data !== null ? obj.data : {}) as Record<
    string,
    unknown
  >;
  const meta = (typeof obj.meta === "object" && obj.meta !== null ? obj.meta : {}) as Record<
    string,
    unknown
  >;
  const dataMeta = (typeof data.meta === "object" && data.meta !== null ? data.meta : {}) as Record<
    string,
    unknown
  >;

  return pass({
    title: pickString(data.name, data.title, meta.name, obj.name),
    device: pickString(data.device, dataMeta.device, obj.device),
    firmwareVersion: pickString(
      data.firmwareVersion,
      data.firmware,
      dataMeta.firmware,
      meta.firmwareVersion,
      meta.firmware,
    ),
  });
}

function sysexCheck(bytes: Buffer, brand: string): ValidationResult {
  if (bytes.length < 8) {
    return fail("FILE_MAGIC_MISMATCH", "SysEx file is too small to be a valid preset");
  }
  if (bytes[0] !== 0xf0) {
    return fail("FILE_MAGIC_MISMATCH", "SysEx files must start with the 0xF0 status byte");
  }
  let end = bytes.length - 1;
  while (
    end > 0 &&
    (bytes[end] === 0x00 || bytes[end] === 0x0a || bytes[end] === 0x0d || bytes[end] === 0x20)
  ) {
    end -= 1;
  }
  if (bytes[end] !== 0xf7) {
    return fail("FILE_MAGIC_MISMATCH", "SysEx files must end with the 0xF7 status byte");
  }
  if (brand === "Fractal Audio") {
    const ok = bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x74;
    if (!ok) {
      return fail(
        "FILE_MAGIC_MISMATCH",
        "Not a Fractal Audio SysEx message (expected manufacturer ID 00 01 74)",
      );
    }
  } else if (brand === "Zoom") {
    if (bytes[1] !== 0x52) {
      return fail("FILE_MAGIC_MISMATCH", "Not a Zoom SysEx message (expected manufacturer ID 52)");
    }
  }
  return pass();
}

function fixedBinaryCheck(bytes: Buffer): ValidationResult {
  if (bytes.length !== 1224) {
    return fail(
      "FILE_SIZE_EXCEEDED",
      "Valeton GP-200 presets must be exactly 1224 bytes — re-export and try again",
    );
  }
  if (bytes.toString("latin1", 0, 4) !== "TSRP") {
    return fail("FILE_MAGIC_MISMATCH", "File does not start with the TSRP preset header");
  }
  if (bytes.toString("latin1", 4, 8) !== "2-PG") {
    return fail("FILE_MAGIC_MISMATCH", "Preset header does not target a GP-200 (2-PG) device");
  }
  return pass();
}

function wavCheck(bytes: Buffer): ValidationResult {
  if (
    bytes.length < 12 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WAVE"
  ) {
    return fail("FILE_MAGIC_MISMATCH", "Companion IR files must be RIFF/WAVE audio (.wav)");
  }
  return pass();
}

export type ValidateFileInput = {
  filename: string;
  role: FileRoleInput;
  /** Overrides the size cap for bundles; ignored for primary preset files. */
  kind?: "file" | "bundle";
};

/** Full pipeline for one stored object's bytes (FR-2.4). */
export function validatePresetFile(
  pedal: PedalSpec,
  input: ValidateFileInput,
  bytes: Buffer,
): ValidationResult {
  const ext = fileExt(input.filename);
  if (!ext) {
    return fail("FILE_EXTENSION_NOT_ALLOWED", "File must have an extension");
  }

  if (input.role === "ir") {
    if (!IR_EXTENSIONS.has(ext)) {
      return fail(
        "FILE_EXTENSION_NOT_ALLOWED",
        `Companion IR files must be one of: ${[...IR_EXTENSIONS].join(", ")}`,
      );
    }
    if (bytes.length === 0) return fail("FILE_EMPTY", "Companion file is empty");
    if (bytes.length > pedal.maxCompanionBytes) {
      return fail(
        "FILE_SIZE_EXCEEDED",
        `Companion files are limited to ${pedal.maxCompanionBytes} bytes each`,
      );
    }
    if (ext === "wav") return wavCheck(bytes);
    if (ext === "syx") return sysexCheck(bytes, pedal.brand);
    const masquerade = rejectMasquerade(bytes);
    return masquerade ?? pass();
  }

  const allowed = pedal.extensions.map((e) => e.toLowerCase());
  if (!allowed.includes(ext)) {
    return fail(
      "FILE_EXTENSION_NOT_ALLOWED",
      `.${ext} files are not accepted for this pedal (allowed: ${allowed.map((e) => "." + e).join(", ")})`,
    );
  }
  if (bytes.length === 0) return fail("FILE_EMPTY", "Preset file is empty");

  const bundle = input.kind === "bundle" || isBundleExt(ext);
  const cap = bundle ? pedal.maxBundleBytes : pedal.maxPresetBytes;
  if (bytes.length > cap) {
    return fail("FILE_SIZE_EXCEEDED", `File is larger than the ${cap} byte limit for this pedal`);
  }

  const masquerade = rejectMasquerade(bytes);
  if (masquerade) return masquerade;

  // Bundles are accepted shallowly by design (SRS 2.2.8 — never split server-side).
  if (bundle) return pass();

  switch (pedal.validationMode) {
    case "DEEP_JSON":
      return deepJsonCheck(bytes);
    case "SYSEX":
      return sysexCheck(bytes, pedal.brand);
    case "FIXED_BINARY":
      return fixedBinaryCheck(bytes);
    case "SHALLOW":
      return pass();
    default:
      return pass();
  }
}

export const CLOUD_LINK_HOSTS = ["cloud.neuraldsp.com"];

export type CloudLinkResult =
  { ok: true; url: string } | { ok: false; code: string; message: string };

/**
 * FR-2.7: exact-host URL validation for Cortex Cloud links.
 * The server never fetches the URL (anti-SSRF).
 */
export function validateCloudLink(raw: string): CloudLinkResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "CLOUD_URL_INVALID", message: "That is not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      code: "CLOUD_URL_INVALID",
      message: "Cortex Cloud links must use https://",
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      code: "CLOUD_URL_INVALID",
      message: "Cortex Cloud links cannot contain credentials",
    };
  }
  if (url.port && url.port !== "443") {
    return {
      ok: false,
      code: "CLOUD_URL_INVALID",
      message: "Cortex Cloud links cannot specify a port",
    };
  }
  if (!CLOUD_LINK_HOSTS.includes(url.hostname)) {
    return {
      ok: false,
      code: "CLOUD_URL_HOST_NOT_ALLOWED",
      message: `Cortex Cloud links must point at ${CLOUD_LINK_HOSTS.join(" or ")} `,
    };
  }
  return { ok: true, url: url.toString() };
}
