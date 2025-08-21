// src/app/api/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

// GET /api/fitments?make=&model=&year=
// Returns fitments filtered by optional make/model and an optional single year that
// must fall within [yearFrom, yearTo] (nulls are treated as open-ended).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const make = searchParams.get('make') || undefined;
  const model = searchParams.get('model') || undefined;
  const yearParam = searchParams.get('year');
  const yearNum = yearParam ? Number(yearParam) : undefined;

  // ✅ Use Prisma’s WhereInput type — no “any”, no union-undefined nonsense
  const where: Prisma.ProductFitmentWhereInput = {};

  if (make)  where.make  = make;
  if (model) where.model = model;

  if (Number.isFinite(yearNum)) {
    // Year falls within [yearFrom, yearTo], allowing nulls as open-ended
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: yearNum as number } }] },
      { OR: [{ yearTo: null },   { yearTo:   { gte: yearNum as number } }] },
    ];
  }

  const fitments = await prisma.productFitment.findMany({
    where,
    orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
  });

  return NextResponse.json({ fitments });
}