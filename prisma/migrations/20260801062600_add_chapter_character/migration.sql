-- CreateTable
CREATE TABLE "ChapterCharacter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "writerCharacterId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterCharacter_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChapterCharacter_writerCharacterId_idx" ON "ChapterCharacter"("writerCharacterId");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterCharacter_chapterId_writerCharacterId_key" ON "ChapterCharacter"("chapterId", "writerCharacterId");

