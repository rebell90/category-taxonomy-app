// src/app/api/admin/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// ---- Types
type FitmentCreateInput = {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

type FitmentUpdateInput = {
  id: string;
  productGid?: string;
  make?: string;
  model?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

function toIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GET /api/admin/fitments?productGid=&make=&model=&year=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const productGid = url.searchParams.get('productGid');
  const make = url.searchParams.get('make');
  const model = url.searchParams.get('model');
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : undefined;

  const where: Parameters<typeof prisma.productFitment.findMany>[0]['where'] = {};

  if (productGid) where.productGid = productGid;
  if (make) where.make = make;
  if (model) where.model = model;

  if (typeof year === 'number' && Number.isFinite(year)) {
    // yearFrom <= year AND (yearTo >= year OR yearTo IS NULL)
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
    ];
  }

  const rows = await prisma.productFitment.findMany({
    where,
    orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
  });
  return NextResponse.json(rows);
}

// POST /api/admin/fitments
export async function POST(req: NextRequest) {
  const body = (await req.json()) as FitmentCreateInput;

  if (!body.productGid || !body.make || !body.model) {
    return NextResponse.json(
      { error: 'productGid, make, and model are required' },
      { status: 400 }
    );
  }

  const created = await prisma.productFitment.create({
    data: {
      productGid: body.productGid,
      make: body.make,
      model: body.model,
      yearFrom: typeof body.yearFrom === 'number' ? body.yearFrom : null,
      yearTo: typeof body.yearTo === 'number' ? body.yearTo : null,
      trim: body.trim ?? null,
      chassis: body.chassis ?? null,
    },
  });

  return NextResponse.json(created);
}

// PUT /api/admin/fitments
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as FitmentUpdateInput;

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const updated = await prisma.productFitment.update({
    where: { id: body.id },
    data: {
      productGid: body.productGid,
      make: body.make,
      model: body.model,
      yearFrom:
        typeof body.yearFrom === 'number'
          ? body.yearFrom
          : body.yearFrom === null
          ? null
          : undefined,
      yearTo:
        typeof body.yearTo === 'number'
          ? body.yearTo
          : body.yearTo === null
          ? null
          : undefined,
      trim: body.trim === undefined ? undefined : body.trim ?? null,
      chassis: body.chassis === undefined ? undefined : body.chassis ?? null,
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/admin/fitments
export async function DELETE(req: NextRequest) {
  const { id } = (await req.json()) as { id?: string };
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await prisma.productFitment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}