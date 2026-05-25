-- SQLite forbids non-constant defaults on ADD COLUMN, so use a fixed
-- placeholder and immediately backfill from createdAt. Prisma's
-- @updatedAt directive will take over on the next write to each row.
ALTER TABLE "ReaderSession" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE "ReaderSession" SET "updatedAt" = "createdAt";
