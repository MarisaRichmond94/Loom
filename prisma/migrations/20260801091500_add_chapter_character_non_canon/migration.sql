-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChapterCharacter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "writerCharacterId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nonCanon" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChapterCharacter_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChapterCharacter" ("chapterId", "createdAt", "id", "writerCharacterId") SELECT "chapterId", "createdAt", "id", "writerCharacterId" FROM "ChapterCharacter";
DROP TABLE "ChapterCharacter";
ALTER TABLE "new_ChapterCharacter" RENAME TO "ChapterCharacter";
CREATE INDEX "ChapterCharacter_writerCharacterId_idx" ON "ChapterCharacter"("writerCharacterId");
CREATE UNIQUE INDEX "ChapterCharacter_chapterId_writerCharacterId_key" ON "ChapterCharacter"("chapterId", "writerCharacterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

