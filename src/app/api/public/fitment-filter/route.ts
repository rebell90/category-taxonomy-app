// src/app/api/public/fitment-filter/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

// --- CORS headers for Shopify -> Render cross-origin calls ---
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',                 // or set to 'https://fullattackperformance.com'
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

// Preflight (Shopify will sometimes send this; browsers will too for some requests)
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Build Prisma where for fitment
function buildFitmentWhere(
  productGids: string[],
  params: { year?: number; makeId?: string; modelId?: string; trimId?: string; chassisId?: string }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;
  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = {
    productGid: { in: productGids },
  };

  // Use relation filters (as per your working v2 code)
  if (makeId)    where.make    = { is: { id: makeId } };
  if (modelId)   where.model   = { is: { id: modelId } };
  if (trimId)    where.trim    = { is: { id: trimId } };
  if (chassisId) where.chassis = { is: { id: chassisId } };

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
    const productGidsParam = (url.searchParams.get('productGids') || '').trim();
    const productGids = productGidsParam
      ? productGidsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (!productGids.length) {
      return NextResponse.json({ allowedProductGids: [] }, { headers: corsHeaders });
    }

    const yearParam = url.searchParams.get('year');
    const params = {
      year: yearParam ? Number(yearParam) : undefined,
      makeId: url.searchParams.get('makeId') || undefined,
      modelId: url.searchParams.get('modelId') || undefined,
      trimId: url.searchParams.get('trimId') || undefined,
      chassisId: url.searchParams.get('chassisId') || undefined,
    };

    const where = buildFitmentWhere(productGids, params);
    if (!where) {
      // No filters → allow all passed products
      return NextResponse.json({ allowedProductGids: productGids }, { headers: corsHeaders });
    }

    // Query fitments and return the intersection
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