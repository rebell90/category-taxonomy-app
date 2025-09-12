-- AlterTable
ALTER TABLE "public"."Category" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "shopifyHandle" VARCHAR(191),
ADD COLUMN     "shopifyPageId" VARCHAR(191);

-- CreateIndex
CREATE INDEX "Category_shopifyHandle_idx" ON "public"."Category"("shopifyHandle");

-- CreateIndex
CREATE INDEX "Category_shopifyPageId_idx" ON "public"."Category"("shopifyPageId");
