// src/app/api/admin/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { rebuildProductFitmentMetafield } from '@/lib/product-metafields'; // make sure this exists

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/* =========================
   Types
========================= */

type FitmentItem = {
  id: string;
  productGid: string;
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  trim: string | null;
  chassis: string | null;
};

type GetResponse = { items: FitmentItem[] };

type PostBody = {
  productGid: string;
  // Term IDs (prefer these)
  makeId: string;
  modelId?: string | null;
  trimId?: string | null;
  chassisId?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
};

type DeleteBody = { id: string };

/* =========================
   Helpers
========================= */

async function termNameOrThrow(id: string, expectedType: 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS'): Promise<string> {
  const t = await prisma.fitTerm.findUnique({
    where: { id },
    select: { id: true, type: true, name: true },
  });
  if (!t) throw new Error(`FitTerm not found: ${id}`);
  if (t.type !== expectedType) throw new Error(`FitTerm ${id} type mismatch: expected ${expectedType}, got ${t.type}`);
  return t.name;
}

function parseIntNullable(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* =========================
   GET /admin/fitments
   Optional filters:
   - productGid
   - make
   - model
   - year
   - trim
   - chassis
========================= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productGid = searchParams.get('productGid') || undefined;
    const make = searchParams.get('make') || undefined;
    const model = searchParams.get('model') || undefined;
    const trim = searchParams.get('trim') || undefined;
    const chassis = searchParams.get('chassis') || undefined;
    const yearParam = searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;

    const where: Prisma.ProductFitmentWhereInput = {};

    if (productGid) where.productGid = { equals: productGid };
    if (make) where.make = { equals: make };
    if (model) where.model = { equals: model };
    if (trim) where.trim = { equals: trim };
    if (chassis) where.chassis = { equals: chassis };

    if (typeof year === 'number' && Number.isFinite(year)) {
      where.AND = [
        { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
        { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
      ];
    }

    const rows = await prisma.productFitment.findMany({
      where,
      orderBy: [{ productGid: 'asc' }, { make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
      select: {
        id: true,
        productGid: true,
        make: true,
        model: true,
        yearFrom: true,
        yearTo: true,
        trim: true,
        chassis: true,
      },
    });

    const items: FitmentItem[] = rows.map(r => ({
      id: r.id,
      productGid: r.productGid,
      make: r.make,
      model: r.model,
      yearFrom: r.yearFrom,
      yearTo: r.yearTo,
      trim: r.trim,
      chassis: r.chassis,
    }));

    return NextResponse.json<GetResponse>({ items }, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS_HEADERS });
  }
}

/* =========================
   POST /admin/fitments
   Body:
   {
     productGid: string,
     makeId: string,
     modelId?: string,
     trimId?: string,
     chassisId?: string,
     yearFrom?: number|null,
     yearTo?: number|null
   }
========================= */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody;

    const productGid = (body.productGid || '').trim();
    if (!productGid) {
      return NextResponse.json({ error: 'Missing productGid' }, { status: 400, headers: CORS_HEADERS });
    }
    if (!body.makeId) {
      return NextResponse.json({ error: 'Missing makeId' }, { status: 400, headers: CORS_HEADERS });
    }

    const makeName = await termNameOrThrow(body.makeId, 'MAKE');
    const modelName = body.modelId ? await termNameOrThrow(body.modelId, 'MODEL') : null;
    const trimName = body.trimId ? await termNameOrThrow(body.trimId, 'TRIM') : null;
    const chassisName = body.chassisId ? await termNameOrThrow(body.chassisId, 'CHASSIS') : null;

    const yearFrom = typeof body.yearFrom === 'number' ? body.yearFrom : null;
    const yearTo = typeof body.yearTo === 'number' ? body.yearTo : null;

    // Create (unique on the combination per your schema)
    const created = await prisma.productFitment.create({
      data: {
        productGid,
        make: makeName,
        model: modelName ?? '',
        trim: trimName,
        chassis: chassisName,
        yearFrom,
        yearTo,
      },
      select: {
        id: true,
        productGid: true,
        make: true,
        model: true,
        yearFrom: true,
        yearTo: true,
        trim: true,
        chassis: true,
      },
    });

    // Rebuild metafield for this product
    await rebuildProductFitmentMetafield(productGid);

    return NextResponse.json<FitmentItem>(created, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS_HEADERS });
  }
}

/* =========================
   DELETE /admin/fitments
   Body: { id: string }
========================= */
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteBody;
    const id = (body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: CORS_HEADERS });
    }

    // Get productGid first (so we can rebuild after delete)
    const existing = await prisma.productFitment.findUnique({
      where: { id },
      select: { id: true, productGid: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Fitment not found' }, { status: 404, headers: CORS_HEADERS });
    }

    await prisma.productFitment.delete({ where: { id } });

    await rebuildProductFitmentMetafield(existing.productGid);

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS_HEADERS });
  }
}