// src/app/api/public/fitment-filter/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

// --- CORS headers for Shopify -> Render cross-origin calls ---
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*', // or 'https://fullattackperformance.com'
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Build Prisma where for fitment (uses scalar columns make/model/trim/chassis that store IDs)
function buildFitmentWhere(
  productGids: string[],
  params: { year?: number; makeId?: string; modelId?: string; trimId?: string; chassisId?: string }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;

  // If no filters at all, skip fitment filtering
  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = {
    productGid: { in: productGids },
  };

  // Your ProductFitment table stores IDs in scalar string columns:
  // make, model, trim, chassis
  if (makeId)    where.make    = { equals: makeId };
  if (modelId)   where.model   = { equals: modelId };
  if (trimId)    where.trim    = { equals: trimId };
  if (chassisId) where.chassis = { equals: chassisId };

  if (typeof year === 'number') {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null },   { yearTo:   { gte: year } }] },
    ];
  }

  return where;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // productGids is a comma-separated list of Shopify product GIDs
    const productGidsParam = (url.searchParams.get('productGids') || '').trim();
    const productGids = productGidsParam
      ? productGidsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (!productGids.length) {
      return NextResponse.json({ allowedProductGids: [] }, { headers: corsHeaders });
    }

    // Optional fitment filters
    const yearParam = url.searchParams.get('year');
    const params = {
      year: yearParam ? Number(yearParam) : undefined,
      makeId: url.searchParams.get('makeId') || undefined,
      modelId: url.searchParams.get('modelId') || undefined,
      trimId: url.searchParams.get('trimId') || undefined,
      chassisId: url.searchParams.get('chassisId') || undefined,
    };

    // Build WHERE; if null, allow all provided productGids (no filtering applied)
    const where = buildFitmentWhere(productGids, params);
    if (!where) {
      return NextResponse.json({ allowedProductGids: productGids }, { headers: corsHeaders });
    }

    // Intersect: only return productGids that have matching fitments
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