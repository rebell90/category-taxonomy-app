// src/app/api/public/fitment-filter/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client'; // <-- add this

// ...

function buildFitmentWhere(
  productGids: string[],
  params: { year?: number; makeId?: string; modelId?: string; trimId?: string; chassisId?: string }
): Prisma.ProductFitmentWhereInput | null { // <-- use Prisma.ProductFitmentWhereInput
  const { year, makeId, modelId, trimId, chassisId } = params;

  // nothing selected → don't filter
  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = {
    productGid: { in: productGids },
  };

  // IMPORTANT: use relational filters because your schema uses relations
  // (If your ProductFitment actually has scalar columns like makeId/modelId,
  // you could switch these back to e.g. { makeId: { equals: makeId } }.)
  if (makeId)    where.make    = { id: makeId };
  if (modelId)   where.model   = { id: modelId };
  if (trimId)    where.trim    = { id: trimId };
  if (chassisId) where.chassis = { id: chassisId };

  if (typeof year === 'number' && !Number.isNaN(year)) {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo:   null }, { yearTo:   { gte: year } }] },
    ];
  }

  return where;
}