-- Revert the backfill from 20260524110000_add_book_published: that migration
-- treated existing books as Published so authors didn't have to re-publish
-- finished work, but the user prefers to opt-in explicitly. Flip every book
-- back to Draft. New books were already defaulting to false, so the column
-- default doesn't need to change.
UPDATE "Book" SET "published" = false;
