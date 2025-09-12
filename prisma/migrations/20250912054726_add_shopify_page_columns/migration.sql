-- CreateEnum
CREATE TYPE "public"."FitTermType" AS ENUM ('MAKE', 'MODEL', 'TRIM', 'CHASSIS');

-- AlterTable
ALTER TABLE "public"."Category" ADD COLUMN     "description" TEXT,
ADD COLUMN     "image" TEXT;

-- CreateTable
CREATE TABLE "public"."ProductFitment" (
    "id" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "chassis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FitTerm" (
    "id" TEXT NOT NULL,
    "type" "public"."FitTermType" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FitTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductFitment_productGid_idx" ON "public"."ProductFitment"("productGid");

-- CreateIndex
CREATE INDEX "ProductFitment_make_model_idx" ON "public"."ProductFitment"("make", "model");

-- CreateIndex
CREATE INDEX "ProductFitment_yearFrom_yearTo_idx" ON "public"."ProductFitment"("yearFrom", "yearTo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFitment_productGid_make_model_yearFrom_yearTo_trim_c_key" ON "public"."ProductFitment"("productGid", "make", "model", "yearFrom", "yearTo", "trim", "chassis");

-- CreateIndex
CREATE INDEX "FitTerm_type_idx" ON "public"."FitTerm"("type");

-- CreateIndex
CREATE INDEX "FitTerm_parentId_idx" ON "public"."FitTerm"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "FitTerm_type_name_parentId_key" ON "public"."FitTerm"("type", "name", "parentId");

-- AddForeignKey
ALTER TABLE "public"."FitTerm" ADD CONSTRAINT "FitTerm_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."FitTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
