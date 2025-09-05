// src/app/api/public/fitment-filter/route.ts (fragment)
import type { Prisma } from '@prisma/client';

function buildFitmentWhere(
  productGids: string[],
  params: { year?: number; makeId?: string; modelId?: string; trimId?: string; chassisId?: string }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;

  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = { productGid: { in: productGids } };

  // Your table columns are strings named `make`, `model`, `trim`, `chassis`
  if (makeId)    where.make    = { equals: makeId };
  if (modelId)   where.model   = { equals: modelId };
  if (trimId)    where.trim    = { equals: trimId };
  if (chassisId) where.chassis = { equals: chassisId };

  if (typeof year === 'number' && !Number.isNaN(year)) {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null },   { yearTo:   { gte: year } }] },
    ];
  }

  return where;
}