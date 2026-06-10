-- Splits the historical "Choice.endingMessage acts as a bad-ending trigger"
-- semantic into two fields: endingMessage stays as the prose, isBadEnding
-- decides whether to render it inline (false) or as a Bad Ending modal
-- that truncates the chapter (true). Existing rows with non-null
-- endingMessage are all pre-existing bad endings, so backfill the flag.
ALTER TABLE "Choice" ADD COLUMN "isBadEnding" BOOLEAN NOT NULL DEFAULT 0;
UPDATE "Choice" SET "isBadEnding" = 1 WHERE "endingMessage" IS NOT NULL;
