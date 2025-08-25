import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function num(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** GET /api/public/category-counts?slugs=a,b,c&make=&model=&year=&trim=&chassis=
 *  Returns: { counts: { "<slug>": number, ... } }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const slugsCsv = (url.searchParams.get('slugs') || '').trim();
    if (!slugsCsv) {
      return NextResponse.json({ error: 'Missing slugs' }, { status: 400, headers: CORS });
    }
    const slugs = slugsCsv.split(',').map(s => s.trim()).filter(Boolean);

    const make    = url.searchParams.get('make')    || null;
    const model   = url.searchParams.get('model')   || null;
    const trim    = url.searchParams.get('trim')    || null;
    const chassis = url.searchParams.get('chassis') || null;
    const year    = num(url.searchParams.get('year'));

    // Map slugs -> ids
    const cats = await prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    });
    const slugToId = new Map(cats.map(c => [c.slug, c.id]));
    const ids = cats.map(c => c.id);
    if (ids.length === 0) {
      return NextResponse.json({ counts: Object.fromEntries(slugs.map(s => [s, 0])) }, { headers: CORS });
    }

    // No YMM -> cheap group by ProductCategory only
    if (!make && !model && !trim && !chassis && year === null) {
      const rows = await prisma.productCategory.groupBy({
        by: ['categoryId'],
        where: { categoryId: { in: ids } },
        _count: { productGid: true },
      });
      const counts: Record<string, number> = Object.fromEntries(slugs.map(s => [s, 0]));
      for (const r of rows) {
        const slug = cats.find(c => c.id === r.categoryId)?.slug;
        if (slug) counts[slug] = r._count.productGid;
      }
      return NextResponse.json({ counts }, { headers: CORS });
    }

    // With YMM -> join ProductFitment
    // Use raw SQL to join ProductCategory(pc) x ProductFitment(pf) with filters
    // NOTE: parameterized + safe placeholders
    const params: any[] = [];
    const slugPlace = slugs.map((_, i) => `$${i + 1}`).join(', ');
    params.push(...slugs);

    let where = `c.slug IN (${slugPlace})`;
    let next = params.length;

    if (make)    { params.push(make);    where += ` AND pf."make" = $${++next}`; }
    if (model)   { params.push(model);   where += ` AND pf."model" = $${++next}`; }
    if (trim)    { params.push(trim);    where += ` AND (pf."trim" = $${++next})`; }
    if (chassis) { params.push(chassis); where += ` AND (pf."chassis" = $${++next})`; }
    if (year !== null) {
      params.push(year, year);
      where += ` AND ( (pf."yearFrom" IS NULL OR pf."yearFrom" <= $${++next - 1})
                   AND (pf."yearTo"   IS NULL OR pf."yearTo"   >= $${++next}) )`;
    }

    const sql = `
      SELECT c.slug, COUNT(DISTINCT pc."productGid") AS cnt
      FROM "ProductCategory" pc
      JOIN "Category" c ON c.id = pc."categoryId"
      JOIN "ProductFitment" pf ON pf."productGid" = pc."productGid"
      WHERE ${where}
      GROUP BY c.slug
    `;

    // @ts-expect-error – generic row typing
    const rows = await prisma.$queryRaw<Array<{ slug: string; cnt: bigint | number }>>(
      prisma.$unsafe(sql),
      ...params
    );

    const counts: Record<string, number> = Object.fromEntries(slugs.map(s => [s, 0]));
    for (const r of rows) {
      counts[r.slug] = Number(r.cnt);
    }
    return NextResponse.json({ counts }, { headers: CORS });
  } catch (e) {
    console.error('category-counts error', e);
    return NextResponse.json({ error: 'Failed to compute counts' }, { status: 500, headers: CORS });
  }
}