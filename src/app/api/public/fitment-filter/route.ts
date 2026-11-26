// src/app/api/public/fitment-filter/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

async function resolveTermNames(ids: (string | undefined)[]): Promise<Map<string, string>> {
  const validIds = ids.filter((id): id is string => !!id);
  if (!validIds.length) return new Map();
  const terms = await prisma.fitTerm.findMany({
    where: { id: { in: validIds } },
    select: { id: true, name: true },
  });
  return new Map(terms.map(t => [t.id, t.name]));
}

/**
 * Matches by ID OR by resolved name so rows that store IDs (new) and rows
 * that store names (old) are both found with the same query.
 * chassis=null on a fitment row means "fits all chassis" and always matches.
 */
function buildFitmentWhere(
  productGids: string[],
  params: {
    year?: number;
    makeId?: string;    resolvedMakeName?: string;
    modelId?: string;   resolvedModelName?: string;
    trimId?: string;    resolvedTrimName?: string;
    chassisId?: string; resolvedChassisName?: string;
  }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;

  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const and: Prisma.ProductFitmentWhereInput[] = [
    { productGid: { in: productGids } },
  ];

  function fieldOr(
    field: 'make' | 'model' | 'trim' | 'chassis',
    id?: string,
    resolved?: string,
  ): Prisma.ProductFitmentWhereInput {
    const clauses: Prisma.ProductFitmentWhereInput[] = [];
    if (id)       clauses.push({ [field]: { equals: id } });
    if (resolved) clauses.push({ [field]: { equals: resolved, mode: 'insensitive' } });
    return { OR: clauses };
  }

  if (makeId)    and.push(fieldOr('make',    makeId,    params.resolvedMakeName));
  if (modelId)   and.push(fieldOr('model',   modelId,   params.resolvedModelName));
  if (trimId)    and.push(fieldOr('trim',    trimId,    params.resolvedTrimName));
  if (chassisId) {
    const chassisOr = fieldOr('chassis', chassisId, params.resolvedChassisName);
    and.push({ OR: [{ chassis: null }, ...(chassisOr.OR ?? [])] });
  }

  if (typeof year === 'number') {
    and.push({ OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] });
    and.push({ OR: [{ yearTo:   null }, { yearTo:   { gte: year } }] });
  }

  return { AND: and };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const productGidsParam = (url.searchParams.get('productGids') || '').trim();
    const productGids = productGidsParam
      ? productGidsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (!productGids.length) {
      return NextResponse.json({ allowedProductGids: [] }, { headers: corsHeaders });
    }

    const yearParam = url.searchParams.get('year');
    const makeId    = url.searchParams.get('makeId')    || undefined;
    const modelId   = url.searchParams.get('modelId')   || undefined;
    const trimId    = url.searchParams.get('trimId')    || undefined;
    const chassisId = url.searchParams.get('chassisId') || undefined;

    // Resolve IDs → names for OR matching against old name-based rows
    const termNames = await resolveTermNames([makeId, modelId, trimId, chassisId]);

    const where = buildFitmentWhere(productGids, {
      year:    yearParam ? Number(yearParam) : undefined,
      makeId,    resolvedMakeName:    makeId    ? termNames.get(makeId)    : undefined,
      modelId,   resolvedModelName:   modelId   ? termNames.get(modelId)   : undefined,
      trimId,    resolvedTrimName:    trimId    ? termNames.get(trimId)    : undefined,
      chassisId, resolvedChassisName: chassisId ? termNames.get(chassisId) : undefined,
    });

    if (!where) {
      return NextResponse.json({ allowedProductGids: productGids }, { headers: corsHeaders });
    }

    const fits = await prisma.productFitment.findMany({
      where,
      select: { productGid: true },
      take: 2000,
    });

    const allowedSet = new Set(fits.map(f => f.productGid));
    const allowedProductGids = productGids.filter(gid => allowedSet.has(gid));

    return NextResponse.json({ allowedProductGids }, { headers: corsHeaders });
  } catch (err) {
    console.error('[fitment-filter] GET failed', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}
