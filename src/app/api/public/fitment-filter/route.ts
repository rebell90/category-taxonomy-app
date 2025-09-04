// Minimal public filter: given product handles and YMM ids/year, return which are allowed.
import { NextRequest, NextResponse } from 'next/server';
import prisma, { Prisma } from '@/lib/prisma';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

function buildWhere(
  productGids: string[],
  params: { year?: number; makeId?: string; modelId?: string; trimId?: string; chassisId?: string }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;
  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = { productGid: { in: productGids } };

  // NOTE: your schema uses relation fields (make/model/trim/chassis) not *_id
  if (makeId)   where.make   = { id: makeId };
  if (modelId)  where.model  = { id: modelId };
  if (trimId)   where.trim   = { id: trimId };
  if (chassisId)where.chassis= { id: chassisId };

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

    const handles = (url.searchParams.getAll('handle') || [])
      .flatMap(h => h.split(','))
      .map(h => h.trim())
      .filter(Boolean);

    // YMM (ids + year)
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    const makeId = url.searchParams.get('makeId') || undefined;
    const modelId = url.searchParams.get('modelId') || undefined;
    const trimId = url.searchParams.get('trimId') || undefined;
    const chassisId = url.searchParams.get('chassisId') || undefined;

    if (!handles.length) {
      return NextResponse.json({ allowedHandles: [], deniedHandles: [] }, { headers: cors });
    }

    // Map handles -> productGid via your Product table (adjust if you store differently)
    const prods = await prisma.product.findMany({
      where: { handle: { in: handles } },
      select: { handle: true, gid: true },
    });
    const byHandle = new Map(prods.map(p => [p.handle, p.gid]));
    const gids = prods.map(p => p.gid);

    // If no YMM provided → allow all
    const where = buildWhere(gids, { year, makeId, modelId, trimId, chassisId });
    if (!where) {
      return NextResponse.json({ allowedHandles: handles, deniedHandles: [] }, { headers: cors });
    }

    // Fitment intersection
    const fits = await prisma.productFitment.findMany({
      where,
      select: { productGid: true },
    });
    const allowedGids = new Set(fits.map(f => f.productGid));

    const allowedHandles: string[] = [];
    const deniedHandles: string[]  = [];

    for (const h of handles) {
      const gid = byHandle.get(h);
      if (gid && allowedGids.has(gid)) allowedHandles.push(h);
      else deniedHandles.push(h);
    }

    return NextResponse.json({ allowedHandles, deniedHandles }, { headers: cors });
  } catch (e) {
    console.error('[fitment-filter] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: cors });
  }
}