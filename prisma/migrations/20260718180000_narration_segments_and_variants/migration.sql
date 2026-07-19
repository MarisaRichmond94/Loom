-- CreateTable
CREATE TABLE "NarrationSegment" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "voice" TEXT NOT NULL,
    "audioPath" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A chapter now has one narration row per unlocked-segment sequence (variant),
-- so chapterId is no longer unique on its own; the fingerprint of the segment
-- sequence (contentHash) distinguishes variants.
-- DropIndex
DROP INDEX "ChapterNarration_chapterId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ChapterNarration_chapterId_contentHash_key" ON "ChapterNarration"("chapterId", "contentHash");

-- CreateIndex
CREATE INDEX "ChapterNarration_chapterId_idx" ON "ChapterNarration"("chapterId");
