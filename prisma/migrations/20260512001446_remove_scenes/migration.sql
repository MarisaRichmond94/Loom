-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Book_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Chapter_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "prompt" TEXT,
    "displayType" TEXT,
    "baseContent" TEXT,
    CONSTRAINT "ContentBlock_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Choice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "choicePointId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "setsVariables" TEXT NOT NULL DEFAULT '{}',
    "targetChapterId" TEXT,
    CONSTRAINT "Choice_choicePointId_fkey" FOREIGN KEY ("choicePointId") REFERENCES "ContentBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Choice_targetChapterId_fkey" FOREIGN KEY ("targetChapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConditionalOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conditionalFragmentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '{}',
    "content" TEXT NOT NULL,
    CONSTRAINT "ConditionalOverride_conditionalFragmentId_fkey" FOREIGN KEY ("conditionalFragmentId") REFERENCES "ContentBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryVariable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "defaultValue" TEXT NOT NULL DEFAULT 'null',
    CONSTRAINT "StoryVariable_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReaderSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentBlockId" TEXT,
    "storyState" TEXT NOT NULL DEFAULT '{}',
    "choiceHistory" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "ReaderSession_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StoryVariable_seriesId_name_key" ON "StoryVariable"("seriesId", "name");
