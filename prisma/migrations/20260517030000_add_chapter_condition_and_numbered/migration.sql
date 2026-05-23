-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN "condition" TEXT;
ALTER TABLE "Chapter" ADD COLUMN "numbered" BOOLEAN NOT NULL DEFAULT true;
