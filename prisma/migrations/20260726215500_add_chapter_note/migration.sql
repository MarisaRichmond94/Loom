-- Adds the per-chapter writer's scratchpad (see ChapterNote in schema.prisma).
--
-- Purely additive: a new table with no writes to any existing row, so live
-- prose is untouched and no backfill is needed. Chapters simply have no note
-- row until the writer types one — the API treats a missing row as "".
--
-- CreateTable
CREATE TABLE "ChapterNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChapterNote_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChapterNote_chapterId_key" ON "ChapterNote"("chapterId");
