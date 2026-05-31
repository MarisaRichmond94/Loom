-- Marks the book the writer is actively working on. Only one per series at
-- a time — the constraint is enforced by the PATCH endpoint, not the DB.
ALTER TABLE "Book" ADD COLUMN "inProgress" BOOLEAN NOT NULL DEFAULT false;
