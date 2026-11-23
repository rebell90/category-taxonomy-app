-- Add soft-delete column to Category
ALTER TABLE "Category" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateTable for two-step archive confirmation tokens
CREATE TABLE "ArchiveToken" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArchiveToken_categoryId_idx" ON "ArchiveToken"("categoryId");
CREATE INDEX "ArchiveToken_expiresAt_idx" ON "ArchiveToken"("expiresAt");
