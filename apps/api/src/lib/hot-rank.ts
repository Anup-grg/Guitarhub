import { prisma } from "./prisma.js";

/**
 * Reddit-style time-decayed hot ranking (SRS FR-4.3):
 *   hot = log10(max(|score|, 1)) + sign(score) · (t_created − t₀) / W
 *
 * Scores are also cached on `Preset.hotRank` (SRS §7.3.4) so feeds can eventually
 * sort on the indexed column; the list endpoint computes the same value at read
 * time, which keeps ordering exact even between refresh ticks.
 */
export const HOT_EPOCH_MS = Date.UTC(2020, 0, 1);
export const HOT_HALF_LIFE_SEC = 45000; // W in SRS FR-4.3 (~12.5 h)

export function hotScore(score: number, createdAt: unknown): number {
  const created = createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  const t = (created.getTime() - HOT_EPOCH_MS) / 1000 / HOT_HALF_LIFE_SEC;
  return Math.log10(Math.max(Math.abs(score), 1)) + Math.sign(score) * t;
}

function tally(votes: { value: number }[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const vote of votes) {
    if (vote.value > 0) up += 1;
    else if (vote.value < 0) down += 1;
  }
  return { up, down };
}

/** Recomputes and stores the cached hot rank for a single preset. */
export async function refreshPresetHotRank(presetId: string): Promise<number> {
  const preset = await prisma.preset.findUnique({ where: { id: presetId } });
  if (!preset) return 0;
  const votes = await prisma.vote.findMany({ where: { presetId } });
  const { up, down } = tally(votes);
  const rank = hotScore(up - down, preset.createdAt);
  await prisma.preset.update({ where: { id: presetId }, data: { hotRank: rank } });
  return rank;
}

/** Worker pass (SRS §7.3.4): recompute every published preset's cached rank. */
export async function refreshAllHotRank(): Promise<number> {
  const presets = await prisma.preset.findMany({ where: { status: "PUBLISHED" } });
  let updated = 0;
  for (const preset of presets) {
    const votes = await prisma.vote.findMany({ where: { presetId: preset.id } });
    const { up, down } = tally(votes);
    await prisma.preset.update({
      where: { id: preset.id },
      data: { hotRank: hotScore(up - down, preset.createdAt) },
    });
    updated += 1;
  }
  return updated;
}
