-- Adds a per-variable "origin book" pointer for the Context modal's
-- Origin column. Stamped by the POST /variables endpoint going forward
-- and backfilled for existing rows via the bundled TS script (run from
-- the project root: `npx tsx prisma/scripts/backfill-variable-origins.ts`).
ALTER TABLE "StoryVariable" ADD COLUMN "originBookId" TEXT;
