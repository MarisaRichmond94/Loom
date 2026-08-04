-- CreateTable
CREATE TABLE "WriterCharacterMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "writerCharacterId" TEXT NOT NULL,
    "age" INTEGER,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "firstBookId" TEXT,
    "deathBookId" TEXT,
    "lastBookId" TEXT,
    CONSTRAINT "WriterCharacterMeta_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WriterCharacterMeta_firstBookId_fkey" FOREIGN KEY ("firstBookId") REFERENCES "Book" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WriterCharacterMeta_deathBookId_fkey" FOREIGN KEY ("deathBookId") REFERENCES "Book" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WriterCharacterMeta_lastBookId_fkey" FOREIGN KEY ("lastBookId") REFERENCES "Book" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WriterCharacterBookMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metaId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "age" INTEGER,
    CONSTRAINT "WriterCharacterBookMeta_metaId_fkey" FOREIGN KEY ("metaId") REFERENCES "WriterCharacterMeta" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WriterCharacterBookMeta_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WriterCharacterSnapshot" (
    "writerCharacterId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "role" TEXT,
    "aliases" TEXT,
    "traits" TEXT NOT NULL DEFAULT '[]',
    "arcNotes" TEXT,
    "goals" TEXT,
    "relationships" TEXT NOT NULL DEFAULT '[]',
    "books" TEXT NOT NULL DEFAULT '[]',
    "photoUrl" TEXT,
    "syncedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "WriterCharacterMeta_firstBookId_idx" ON "WriterCharacterMeta"("firstBookId");

-- CreateIndex
CREATE INDEX "WriterCharacterMeta_deathBookId_idx" ON "WriterCharacterMeta"("deathBookId");

-- CreateIndex
CREATE INDEX "WriterCharacterMeta_lastBookId_idx" ON "WriterCharacterMeta"("lastBookId");

-- CreateIndex
CREATE UNIQUE INDEX "WriterCharacterMeta_seriesId_writerCharacterId_key" ON "WriterCharacterMeta"("seriesId", "writerCharacterId");

-- CreateIndex
CREATE INDEX "WriterCharacterBookMeta_bookId_idx" ON "WriterCharacterBookMeta"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "WriterCharacterBookMeta_metaId_bookId_key" ON "WriterCharacterBookMeta"("metaId", "bookId");
