-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReaderSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentBlockId" TEXT,
    "storyState" TEXT NOT NULL DEFAULT '{}',
    "choiceHistory" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "ReaderSession_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReaderSession" ("choiceHistory", "createdAt", "currentBlockId", "id", "seriesId", "storyState", "updatedAt") SELECT "choiceHistory", "createdAt", "currentBlockId", "id", "seriesId", "storyState", "updatedAt" FROM "ReaderSession";
DROP TABLE "ReaderSession";
ALTER TABLE "new_ReaderSession" RENAME TO "ReaderSession";
CREATE INDEX "ReaderSession_seriesId_idx" ON "ReaderSession"("seriesId");
CREATE INDEX "ReaderSession_updatedAt_idx" ON "ReaderSession"("updatedAt");
CREATE TABLE "new_StoryVariable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "defaultValue" TEXT NOT NULL DEFAULT 'null',
    "originBookId" TEXT,
    CONSTRAINT "StoryVariable_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryVariable_originBookId_fkey" FOREIGN KEY ("originBookId") REFERENCES "Book" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StoryVariable" ("defaultValue", "id", "name", "originBookId", "seriesId", "type") SELECT "defaultValue", "id", "name", "originBookId", "seriesId", "type" FROM "StoryVariable";
DROP TABLE "StoryVariable";
ALTER TABLE "new_StoryVariable" RENAME TO "StoryVariable";
CREATE INDEX "StoryVariable_originBookId_idx" ON "StoryVariable"("originBookId");
CREATE UNIQUE INDEX "StoryVariable_seriesId_name_key" ON "StoryVariable"("seriesId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Book_seriesId_order_idx" ON "Book"("seriesId", "order");

-- CreateIndex
CREATE INDEX "Chapter_bookId_order_idx" ON "Chapter"("bookId", "order");

-- CreateIndex
CREATE INDEX "Character_seriesId_idx" ON "Character"("seriesId");

-- CreateIndex
CREATE INDEX "Character_firstBookId_idx" ON "Character"("firstBookId");

-- CreateIndex
CREATE INDEX "Character_deathBookId_idx" ON "Character"("deathBookId");

-- CreateIndex
CREATE INDEX "Character_lastBookId_idx" ON "Character"("lastBookId");

-- CreateIndex
CREATE INDEX "CharacterBookOverride_bookId_idx" ON "CharacterBookOverride"("bookId");

-- CreateIndex
CREATE INDEX "Choice_choicePointId_idx" ON "Choice"("choicePointId");

-- CreateIndex
CREATE INDEX "Choice_targetChapterId_idx" ON "Choice"("targetChapterId");

-- CreateIndex
CREATE INDEX "ConditionalOverride_conditionalFragmentId_order_idx" ON "ConditionalOverride"("conditionalFragmentId", "order");

-- CreateIndex
CREATE INDEX "ContentBlock_chapterId_order_idx" ON "ContentBlock"("chapterId", "order");
