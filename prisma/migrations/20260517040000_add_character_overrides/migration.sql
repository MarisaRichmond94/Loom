-- AlterTable
ALTER TABLE "Character" ADD COLUMN "firstBookId" TEXT REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CharacterBookOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "age" INTEGER,
    CONSTRAINT "CharacterBookOverride_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CharacterBookOverride_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterBookOverride_characterId_bookId_key" ON "CharacterBookOverride"("characterId", "bookId");
