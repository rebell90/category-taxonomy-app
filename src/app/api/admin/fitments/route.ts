// src/app/api/admin/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/** Utility: parse optional year query/body fields to number | null */
function parseYear(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** GET /api/admin/fitments?productGid=...&make=...&model=...&year=... */
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
    if (make)       where.make       = { equals: make };
    if (model)      where.model      = { equals: model };
    if (trim)       where.trim       = { equals: trim };
    if (chassis)    where.chassis    = { equals: chassis };

    if (typeof year === 'number' && Number.isFinite(year)) {
      // Match ranges that cover this year; include open-ended sides
      where.AND = [
        {
          OR: [
            { yearFrom: { lte: year } },
            { yearFrom: null },
          ],
        },
        {
          OR: [
            { yearTo: { gte: year } },
            { yearTo: null },
          ],
        },
      ];
    }

    const rows = await prisma.productFitment.findMany({
      where,
      orderBy: [{ productGid: 'asc' }, { make: 'asc' }, { model: 'asc' }],
    });

    return NextResponse.json({ fitments: rows });
  } catch (err) {
    console.error('GET /admin/fitments error', err);
    return NextResponse.json({ error: 'Failed to list fitments' }, { status: 500 });
  }
}

/** POST /api/admin/fitments  (create one)
 *  body: { productGid, make, model, yearFrom?, yearTo?, trim?, chassis? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const productGid: string | undefined = body?.productGid;
    const make: string | undefined       = body?.make;
    const model: string | undefined      = body?.model;
    const trim: string | null            = body?.trim ?? null;
    const chassis: string | null         = body?.chassis ?? null;

    if (!productGid || !make || !model) {
      return NextResponse.json(
        { error: 'Missing productGid, make, or model' },
        { status: 400 }
      );
    }

    const yearFromNum = parseYear(body?.yearFrom);
    const yearToNum   = parseYear(body?.yearTo);

    // Build data with conditional spreads so yearFrom/yearTo are only present when numeric
    const data: Prisma.ProductFitmentCreateInput = {
      productGid,
      make,
      model,
      ...(trim !== null && { trim }),         // only include if provided
      ...(chassis !== null && { chassis }),   // only include if provided
      ...(yearFromNum !== null && { yearFrom: yearFromNum }),
      ...(yearToNum   !== null && { yearTo: yearToNum }),
    };

    const created = await prisma.productFitment.create({ data });

    // Optional: update product metafield projection after change
    try {
      const mod = await import('@/lib/product-metafields').catch(() => null);
      const rebuild = mod?.rebuildProductFitmentMetafield as
        | ((gid: string) => Promise<void>)
        | undefined;
      if (rebuild) await rebuild(productGid);
    } catch (e) {
      console.warn('Fitment metafield rebuild skipped:', e);
    }

    return NextResponse.json({ fitment: created }, { status: 201 });
  } catch (err) {
    console.error('POST /admin/fitments error', err);
    return NextResponse.json({ error: 'Create fitment failed' }, { status: 500 });
  }
}

/** DELETE /api/admin/fitments
 *  body: { id } OR { productGid, make, model, yearFrom?, yearTo?, trim?, chassis? }
 *  If id present, delete by id; otherwise delete by compound criteria.
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();

    const id: string | undefined = body?.id;

    if (id) {
      const deleted = await prisma.productFitment.delete({ where: { id } });

      // optional metafield rebuild
      try {
        const mod = await import('@/lib/product-metafields').catch(() => null);
        const rebuild = mod?.rebuildProductFitmentMetafield as
          | ((gid: string) => Promise<void>)
          | undefined;
        if (rebuild) await rebuild(deleted.productGid);
      } catch (e) {
        console.warn('Fitment metafield rebuild skipped:', e);
      }

      return NextResponse.json({ success: true, deleted });
    }

    // delete by criteria (when no id is provided)
    const productGid: string | undefined = body?.productGid;
    const make: string | undefined       = body?.make;
    const model: string | undefined      = body?.model;

    if (!productGid || !make || !model) {
      return NextResponse.json(
        { error: 'Provide id OR (productGid, make, model) for delete' },
        { status: 400 }
      );
    }

    const yearFromNum = parseYear(body?.yearFrom);
    const yearToNum   = parseYear(body?.yearTo);
    const trim: string | null    = body?.trim ?? null;
    const chassis: string | null = body?.chassis ?? null;

    const where: Prisma.ProductFitmentWhereInput = {
      productGid: { equals: productGid },
      make:       { equals: make },
      model:      { equals: model },
      ...(trim     !== null && { trim: { equals: trim } }),
      ...(chassis  !== null && { chassis: { equals: chassis } }),
      ...(yearFromNum !== null && { yearFrom: { equals: yearFromNum } }),
      ...(yearToNum   !== null && { yearTo:   { equals: yearToNum } }),
    };

    const deletedMany = await prisma.productFitment.deleteMany({ where });

    // optional metafield rebuild
    try {
      const mod = await import('@/lib/product-metafields').catch(() => null);
      const rebuild = mod?.rebuildProductFitmentMetafield as
        | ((gid: string) => Promise<void>)
        | undefined;
      if (rebuild) await rebuild(productGid);
    } catch (e) {
      console.warn('Fitment metafield rebuild skipped:', e);
    }

    return NextResponse.json({ success: true, count: deletedMany.count });
  } catch (err) {
    console.error('DELETE /admin/fitments error', err);
    return NextResponse.json({ error: 'Delete fitment failed' }, { status: 500 });
  }
}