-- CreateTable
CREATE TABLE "ChapterEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "writerEventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterEvent_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChapterEvent_writerEventId_idx" ON "ChapterEvent"("writerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterEvent_chapterId_writerEventId_key" ON "ChapterEvent"("chapterId", "writerEventId");

