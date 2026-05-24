-- AlterTable: new column defaults to false (drafts) for future inserts,
-- but every existing book is backfilled to true so the author doesn't have
-- to re-publish content that was already finished before this feature
-- landed. Authors can flip any of these to draft from the book page.
ALTER TABLE "Book" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Book" SET "published" = true;
