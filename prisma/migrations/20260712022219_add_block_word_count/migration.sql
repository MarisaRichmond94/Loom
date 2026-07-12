-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContentBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "prompt" TEXT,
    "displayType" TEXT,
    "baseContent" TEXT,
    "condition" TEXT,
    "pinStart" INTEGER,
    "pinEnd" INTEGER,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ContentBlock_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContentBlock" ("baseContent", "chapterId", "condition", "content", "displayType", "id", "order", "pinEnd", "pinStart", "prompt", "type") SELECT "baseContent", "chapterId", "condition", "content", "displayType", "id", "order", "pinEnd", "pinStart", "prompt", "type" FROM "ContentBlock";
DROP TABLE "ContentBlock";
ALTER TABLE "new_ContentBlock" RENAME TO "ContentBlock";
CREATE INDEX "ContentBlock_chapterId_order_idx" ON "ContentBlock"("chapterId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
