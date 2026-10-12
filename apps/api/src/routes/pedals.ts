import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../errors/problem.js";

export const pedalsRouter = Router();

function serializePedalSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    slug: row.slug,
    aliases: row.aliases,
    extensions: row.extensions,
    validationMode: row.validationMode,
    firmwareNotes: row.firmwareNotes ?? null,
    maxPresetBytes: row.maxPresetBytes,
    maxBundleBytes: row.maxBundleBytes,
    maxCompanionBytes: row.maxCompanionBytes,
  };
}

pedalsRouter.get("/", async (_req, res) => {
  const rows = await prisma.pedal.findMany({
    where: { enabled: true },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });
  const pedals = await Promise.all(
    rows.map(async (row) => {
      const presetCount = await prisma.preset.count({
        where: { pedalId: row.id, status: "PUBLISHED" },
      });
      return { ...serializePedalSummary(row), presetCount };
    }),
  );
  res.json({ pedals });
});

pedalsRouter.get("/:slug", async (req, res) => {
  const row = await prisma.pedal.findUnique({ where: { slug: String(req.params.slug) } });
  if (!row || !row.enabled) {
    throw new ApiError(404, "PEDAL_NOT_FOUND", "No such pedal in the catalog");
  }
  const presetCount = await prisma.preset.count({
    where: { pedalId: row.id, status: "PUBLISHED" },
  });
  res.json({
    pedal: {
      ...serializePedalSummary(row),
      importInstructionsMd: row.importInstructionsMd,
      presetCount,
    },
  });
});
