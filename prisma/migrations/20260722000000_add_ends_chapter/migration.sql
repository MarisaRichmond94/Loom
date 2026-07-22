-- "End of chapter early" markers: a clean sibling of the bad-ending flags.
-- On a Choice, picking the option ends the chapter; on a ConditionalOverride,
-- a matched override ends the chapter. Every block after the marker is dropped
-- for the reader, narration, and canon export, but — unlike a bad ending —
-- there is no death modal or rewind and the reader advances normally.
-- New behavior only, so no backfill: all existing rows default to false.
ALTER TABLE "Choice" ADD COLUMN "endsChapter" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "ConditionalOverride" ADD COLUMN "endsChapter" BOOLEAN NOT NULL DEFAULT 0;
