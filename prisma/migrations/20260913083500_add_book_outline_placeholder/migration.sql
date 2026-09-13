-- LOOM-153, under LOOM-146.
--
-- A NEW TABLE, so the foreign key is free: SQLite only needs a table rebuild to
-- add a constraint to an EXISTING table, which is why Book.divergesFromBookId
-- had to go without one. Nothing existing is touched here.

-- CreateTable
CREATE TABLE "BookOutlinePlaceholder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "position" REAL NOT NULL,
    "heading" TEXT NOT NULL DEFAULT '',
    "pov" TEXT NOT NULL DEFAULT '',
    "date" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookOutlinePlaceholder_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BookOutlinePlaceholder_bookId_position_idx" ON "BookOutlinePlaceholder"("bookId", "position");
