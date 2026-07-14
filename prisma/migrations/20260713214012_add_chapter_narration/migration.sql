-- CreateTable
CREATE TABLE "ChapterNarration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "audioPath" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChapterNarration_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChapterNarration_chapterId_key" ON "ChapterNarration"("chapterId");
