-- LOOM-154, under LOOM-146.
--
-- Two nullable columns and an index: ALTER TABLE ADD COLUMN is in-place, and
-- CREATE INDEX does not rewrite the table. No foreign key on parentSessionId —
-- adding one would mean rebuilding ReaderSession, for referential sugar whose
-- absence costs a grouping label and nothing else.

-- AlterTable
ALTER TABLE "ReaderSession" ADD COLUMN "parentSessionId" TEXT;
ALTER TABLE "ReaderSession" ADD COLUMN "forkedAtChoicePointId" TEXT;

-- CreateIndex
CREATE INDEX "ReaderSession_parentSessionId_idx" ON "ReaderSession"("parentSessionId");
