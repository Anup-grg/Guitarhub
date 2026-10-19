import type { ValidationMode } from "@prisma/client";

export const MB = 1024 * 1024;

export type PedalSeed = {
  brand: string;
  model: string;
  slug: string;
  aliases: string[];
  validationMode: ValidationMode;
  extensions: string[];
  firmwareNotes?: string;
  importInstructionsMd: string;
  maxPresetBytes?: number;
  maxBundleBytes?: number;
};

const line6Instructions = `1. Open **HX Edit** (or Helix Native in your DAW) and connect the pedal.
2. Drag the \`.hlx\` file onto an empty preset slot, or use *File → Import*.
3. For a setlist (\`.hls\`), use *File → Import Setlist*.
4. Check the firmware version above matches the version your pedal runs.`;

const fractalInstructions = `1. Open **Axe-Edit / FM9-Edit / FM3-Edit** connected to the pedal.
2. *Presets → Import…* and select the \`.syx\` file (or drag it onto a preset slot).
3. For a \`.fasBundle\`, import the bundle to pull in presets + matching cabs together.`;

const cortexInstructions = `This preset lives on **Cortex Cloud** — there is no file to download.
1. Click *Open in Cortex Cloud* (opens in a new tab).
2. Sign in and click **Save to My Cloud**.
3. On your Quad Cortex, find it under *Cloud → Saved* and download to the device.`;

const bossInstructions = `1. Open **BOSS TONE STUDIO** for your model and connect the pedal.
2. Go to *Librarian → Import* and select the \`.tsl\` liveset.
3. The liveset contains multiple patches — they appear as a group you can drag to the device.`;

const flammaInstructions = `1. Open the **Flamma editor** for your model.
2. Use *Import/Load* and select the \`.pfl\` file.
3. Write the preset to the pedal from the editor.`;

const zoomInstructions = `1. Open **ZOOM Guitar Lab** connected to the pedal.
2. Drag the \`.zptc\` file into the patch list, or use *File → Import*.
3. Sync the patch to the pedal.`;

const zoomSysexInstructions = `1. This is a raw MIDI **SysEx dump** (\`.syx\`).
2. Load it with the Zoom MS utility or any SysEx sender (e.g. Bome Send SX).
3. Send the file to the pedal, then save to a memory slot on the device.`;

const nuxInstructions = `1. Open **QuickTone** for your model and connect the pedal.
2. Use *File → Import* and select the patch file.
3. GEN2 firmware only works with GEN2 QuickTone; V5 firmware with V5 QuickTone.`;

const valetonInstructions = `1. Open the **Valeton GP-200 editor**.
2. Import the \`.prst\` file into a preset slot.
3. The file is validated strictly (exactly 1224 bytes) — re-export if rejected.`;

export const pedals: PedalSeed[] = [
  {
    brand: "Line 6",
    model: "Helix",
    slug: "line6-helix",
    aliases: ["Helix Floor"],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "Helix LT",
    slug: "line6-helix-lt",
    aliases: ["LT"],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "Helix Rack",
    slug: "line6-helix-rack",
    aliases: ["Rack"],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "HX Stomp",
    slug: "line6-hx-stomp",
    aliases: [],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "HX Stomp XL",
    slug: "line6-hx-stomp-xl",
    aliases: [],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "HX Effects",
    slug: "line6-hx-effects",
    aliases: ["HX FX"],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "Helix Native",
    slug: "line6-helix-native",
    aliases: ["Native"],
    validationMode: "DEEP_JSON",
    extensions: ["hlx", "hls"],
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Line 6",
    model: "Helix Stadium",
    slug: "line6-helix-stadium",
    aliases: ["Stadium"],
    validationMode: "DEEP_JSON",
    extensions: ["hsp", "hss"],
    firmwareNotes:
      "Stadium (.hsp) presets use a new schema and are not back-compatible with legacy Helix devices once re-saved.",
    importInstructionsMd: line6Instructions,
  },
  {
    brand: "Fractal Audio",
    model: "Axe-Fx III",
    slug: "fractal-axe-fx-iii",
    aliases: ["Axe-Fx 3", "Axe III"],
    validationMode: "SYSEX",
    extensions: ["syx", "fasBundle"],
    importInstructionsMd: fractalInstructions,
  },
  {
    brand: "Fractal Audio",
    model: "Axe-Fx II",
    slug: "fractal-axe-fx-ii",
    aliases: ["Axe-Fx 2", "Axe II"],
    validationMode: "SYSEX",
    extensions: ["syx", "fasBundle"],
    importInstructionsMd: fractalInstructions,
  },
  {
    brand: "Fractal Audio",
    model: "FM9",
    slug: "fractal-fm9",
    aliases: [],
    validationMode: "SYSEX",
    extensions: ["syx", "fasBundle"],
    importInstructionsMd: fractalInstructions,
  },
  {
    brand: "Fractal Audio",
    model: "FM3",
    slug: "fractal-fm3",
    aliases: [],
    validationMode: "SYSEX",
    extensions: ["syx", "fasBundle"],
    importInstructionsMd: fractalInstructions,
  },
  {
    brand: "Neural DSP",
    model: "Quad Cortex",
    slug: "neural-quad-cortex",
    aliases: ["QC"],
    validationMode: "CLOUD_LINK",
    extensions: [],
    firmwareNotes: "No local file format — presets are shared through Cortex Cloud.",
    importInstructionsMd: cortexInstructions,
  },
  {
    brand: "Boss",
    model: "GT-1000",
    slug: "boss-gt-1000",
    aliases: [],
    validationMode: "SHALLOW",
    extensions: ["tsl"],
    importInstructionsMd: bossInstructions,
  },
  {
    brand: "Boss",
    model: "GT-1000CORE",
    slug: "boss-gt-1000core",
    aliases: ["GT-1000 Core"],
    validationMode: "SHALLOW",
    extensions: ["tsl"],
    importInstructionsMd: bossInstructions,
  },
  {
    brand: "Boss",
    model: "GT-1",
    slug: "boss-gt-1",
    aliases: [],
    validationMode: "SHALLOW",
    extensions: ["tsl"],
    importInstructionsMd: bossInstructions,
  },
  {
    brand: "Boss",
    model: "GT-1B",
    slug: "boss-gt-1b",
    aliases: [],
    validationMode: "SHALLOW",
    extensions: ["tsl"],
    importInstructionsMd: bossInstructions,
  },
  {
    brand: "Flamma",
    model: "FX-200",
    slug: "flamma-fx-200",
    aliases: ["FX200"],
    validationMode: "SHALLOW",
    extensions: ["pfl"],
    importInstructionsMd: flammaInstructions,
  },
  {
    brand: "Flamma",
    model: "FX-150",
    slug: "flamma-fx-150",
    aliases: ["FX150"],
    validationMode: "SHALLOW",
    extensions: ["pfl"],
    importInstructionsMd: flammaInstructions,
  },
  {
    brand: "Zoom",
    model: "G5n",
    slug: "zoom-g5n",
    aliases: [],
    validationMode: "SHALLOW",
    extensions: ["zptc"],
    importInstructionsMd: zoomInstructions,
  },
  {
    brand: "Zoom",
    model: "G3n",
    slug: "zoom-g3n",
    aliases: [],
    validationMode: "SHALLOW",
    extensions: ["zptc"],
    importInstructionsMd: zoomInstructions,
  },
  {
    brand: "Zoom",
    model: "G3Xn",
    slug: "zoom-g3xn",
    aliases: [],
    validationMode: "SHALLOW",
    extensions: ["zptc"],
    importInstructionsMd: zoomInstructions,
  },
  {
    brand: "Zoom",
    model: "G1 Four",
    slug: "zoom-g1-four",
    aliases: ["G1Four"],
    validationMode: "SHALLOW",
    extensions: ["zptc"],
    importInstructionsMd: zoomInstructions,
  },
  {
    brand: "Zoom",
    model: "G1X Four",
    slug: "zoom-g1x-four",
    aliases: ["G1XFour"],
    validationMode: "SHALLOW",
    extensions: ["zptc"],
    importInstructionsMd: zoomInstructions,
  },
  {
    brand: "Zoom",
    model: "MS-50G",
    slug: "zoom-ms-50g",
    aliases: ["MS50G"],
    validationMode: "SYSEX",
    extensions: ["syx"],
    importInstructionsMd: zoomSysexInstructions,
  },
  {
    brand: "NUX",
    model: "MG-30",
    slug: "nux-mg-30",
    aliases: ["MG30"],
    validationMode: "SHALLOW",
    extensions: ["mg30patch", "nuxpreset"],
    firmwareNotes: "GEN2 firmware only works with GEN2 QuickTone; V5 firmware with V5 QuickTone.",
    importInstructionsMd: nuxInstructions,
  },
  {
    brand: "NUX",
    model: "MG-400",
    slug: "nux-mg-400",
    aliases: ["MG400"],
    validationMode: "SHALLOW",
    extensions: ["mg400patch", "nuxpreset"],
    firmwareNotes: "GEN2 firmware only works with GEN2 QuickTone; V5 firmware with V5 QuickTone.",
    importInstructionsMd: nuxInstructions,
  },
  {
    brand: "Valeton",
    model: "GP-200",
    slug: "valeton-gp-200",
    aliases: ["GP200"],
    validationMode: "FIXED_BINARY",
    extensions: ["prst"],
    firmwareNotes: "Preset files are validated strictly: exactly 1224 bytes with a TSRP header.",
    importInstructionsMd: valetonInstructions,
  },
];

export const tags: { slug: string; label: string }[] = [
  { slug: "clean", label: "Clean" },
  { slug: "crunch", label: "Crunch" },
  { slug: "lead", label: "Lead" },
  { slug: "high-gain", label: "High Gain" },
  { slug: "ambient", label: "Ambient" },
  { slug: "rock", label: "Rock" },
  { slug: "metal", label: "Metal" },
  { slug: "blues", label: "Blues" },
  { slug: "jazz", label: "Jazz" },
  { slug: "punk", label: "Punk" },
  { slug: "worship", label: "Worship" },
  { slug: "indie", label: "Indie" },
  { slug: "bedroom", label: "Bedroom" },
  { slug: "recording", label: "Recording" },
  { slug: "practice", label: "Practice" },
];
