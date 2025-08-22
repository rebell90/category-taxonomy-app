import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type Body = { productGids: string[] };

export async function POST(req: NextRequest) {
  try {
    const { productGids }: Body = await req.json();

    if (!Array.isArray(productGids) || productGids.length === 0) {
      return NextResponse.json({ error: 'productGids[] required' }, { status: 400 });
    }

    const rows = await prisma.productFitment.findMany({
      where: { productGid: { in: productGids } },
      orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
    });

    // Group by productGid
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!map.has(r.productGid)) map.set(r.productGid, []);
      map.get(r.productGid)!.push(r);
    }

    const items = productGids.map(pg => ({
      productGid: pg,
      fitments: map.get(pg) ?? [],
    }));

    return NextResponse.json({ items });
  } catch (e) {
    console.error('fitments/by-products error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}