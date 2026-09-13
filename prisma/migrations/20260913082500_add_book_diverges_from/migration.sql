-- LOOM-147/152, under LOOM-146.
--
-- ALTER TABLE ADD COLUMN: in-place, no table rebuild, no data movement.
--
-- Nullable with no default and no FK constraint. A foreign key would require
-- rebuilding Book, which is the spine of a 240MB production database; the
-- cleanup it would buy is done explicitly in the book DELETE route instead.
-- See the schema comment on Book.divergesFromBookId.

-- AlterTable
ALTER TABLE "Book" ADD COLUMN "divergesFromBookId" TEXT;

-- CreateIndex
CREATE INDEX "Book_divergesFromBookId_idx" ON "Book"("divergesFromBookId");
