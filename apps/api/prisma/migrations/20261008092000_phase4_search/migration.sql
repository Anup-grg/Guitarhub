-- Phase 4: browse & search (SRS FR-3.3 / FR-3.4 / FR-3.5).
-- ILIKE "%term%" (Prisma `contains`, case-insensitive) is backed by trigram
-- GIN indexes so full-text-ish search over titles, songs and tags stays fast.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Preset_title_trgm_idx" ON "Preset" USING GIN (lower("title") gin_trgm_ops);
CREATE INDEX "Preset_songTitle_trgm_idx" ON "Preset" USING GIN (lower("songTitle") gin_trgm_ops);
CREATE INDEX "Preset_artist_trgm_idx" ON "Preset" USING GIN (lower("artist") gin_trgm_ops);
CREATE INDEX "Tag_label_trgm_idx" ON "Tag" USING GIN (lower("label") gin_trgm_ops);
CREATE INDEX "User_displayName_trgm_idx" ON "User" USING GIN (lower("displayName") gin_trgm_ops);

-- Download-event dedupe ledger (already unique on presetId+clientKey+day).
CREATE INDEX "DownloadEvent_presetId_day_idx" ON "DownloadEvent"("presetId", "day");