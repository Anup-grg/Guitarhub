-- Phase 5: votes, comments & hot ranking (SRS FR-4).
-- Comments store the sanitizer version that produced bodyHtml so bodies are
-- re-rendered on read when the Markdown sanitizer changes (FR-4.4).
ALTER TABLE "Comment" ADD COLUMN "bodyHtmlVersion" INTEGER NOT NULL DEFAULT 1;

-- Threaded listing (top-level comments + one level of replies).
CREATE INDEX "Comment_presetId_parentId_idx" ON "Comment"("presetId", "parentId");

-- Per-reporter open reports (dedupe + "my reports").
CREATE INDEX "Report_reporterId_status_idx" ON "Report"("reporterId", "status");
