-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Choice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "choicePointId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "setsVariables" TEXT NOT NULL DEFAULT '{}',
    "condition" TEXT,
    "targetChapterId" TEXT,
    "endingMessage" TEXT,
    "isBadEnding" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Choice_choicePointId_fkey" FOREIGN KEY ("choicePointId") REFERENCES "ContentBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Choice_targetChapterId_fkey" FOREIGN KEY ("targetChapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Choice" ("choicePointId", "endingMessage", "id", "isBadEnding", "label", "setsVariables", "targetChapterId") SELECT "choicePointId", "endingMessage", "id", "isBadEnding", "label", "setsVariables", "targetChapterId" FROM "Choice";
DROP TABLE "Choice";
ALTER TABLE "new_Choice" RENAME TO "Choice";
CREATE INDEX "Choice_choicePointId_idx" ON "Choice"("choicePointId");
CREATE INDEX "Choice_targetChapterId_idx" ON "Choice"("targetChapterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill `order`: the rebuild above copied every row with the DEFAULT 0,
-- so without this each choice point's options would all read as order 0 and
-- the "first two are the ungated base pair" rule would be undefined. Number
-- each choice point's options 0,1,2,… by creation order (cuid id ascending ≈
-- creation order), which puts the two seeded base options (originally "Yes"
-- then "No") at orders 0 and 1. Idempotent for the current data: every
-- existing choice point has exactly its two base options.
UPDATE "Choice"
SET "order" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "choicePointId" ORDER BY "id" ASC) - 1 AS rn
  FROM "Choice"
) AS sub
WHERE "Choice"."id" = sub."id";
