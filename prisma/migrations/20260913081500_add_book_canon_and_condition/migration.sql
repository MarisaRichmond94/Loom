-- LOOM-148, under LOOM-146.
--
-- Both statements are SQLite ALTER TABLE ADD COLUMN: in-place, no table
-- rebuild, no data movement.
--
-- `NOT NULL DEFAULT true` IS the backfill — SQLite writes the default into
-- every existing row. This is load-bearing: a `canon` that landed false would
-- silently unhook every existing book from the canon export, export-status,
-- WriteAI ingest and publish, because each of those is a `where` filter that
-- would then match nothing.

-- AlterTable
ALTER TABLE "Book" ADD COLUMN "canon" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Book" ADD COLUMN "condition" TEXT;
