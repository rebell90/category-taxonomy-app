// src/app/api/public/fitment-filter/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client'; // <-- add this

// ...

function buildFitmentWhere(
  productGids: string[],
  params: { year?: number; makeId?: string; modelId?: string; trimId?: string; chassisId?: string }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;

  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = { productGid: { in: productGids } };

  // RELATION filters (use `is: { id: ... }`)
  if (makeId)    where.make    = { is: { id: makeId } };
  if (modelId)   where.model   = { is: { id: modelId } };
  if (trimId)    where.trim    = { is: { id: trimId } };
  if (chassisId) where.chassis = { is: { id: chassisId } };

  if (typeof year === 'number' && !Number.isNaN(year)) {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null },   { yearTo:   { gte: year } }] },
    ];
  }

  return where;
}