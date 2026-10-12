-- Phase 6: administration & moderation (SRS FR-7.4).
-- Blacklisted tags are detached from every preset and rejected on publish.
ALTER TABLE "Tag" ADD COLUMN "blacklisted" BOOLEAN NOT NULL DEFAULT false;
