-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChapterEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "writerEventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nonCanon" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChapterEvent_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChapterEvent" ("chapterId", "createdAt", "id", "writerEventId") SELECT "chapterId", "createdAt", "id", "writerEventId" FROM "ChapterEvent";
DROP TABLE "ChapterEvent";
ALTER TABLE "new_ChapterEvent" RENAME TO "ChapterEvent";
CREATE INDEX "ChapterEvent_writerEventId_idx" ON "ChapterEvent"("writerEventId");
CREATE UNIQUE INDEX "ChapterEvent_chapterId_writerEventId_key" ON "ChapterEvent"("chapterId", "writerEventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
