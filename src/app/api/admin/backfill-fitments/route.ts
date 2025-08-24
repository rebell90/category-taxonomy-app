import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { rebuildProductFitmentMetafield } from '@/lib/product-metafields';

const SECRET = process.env.BACKFILL_SECRET;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!SECRET || secret !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distinct productGids that have any fitments
  const gids = await prisma.productFitment.findMany({
    select: { productGid: true },
    distinct: ['productGid']
  });

  const results: Array<{ productGid: string; ok: boolean; error?: string }> = [];

  for (const { productGid } of gids) {
    try {
      await rebuildProductFitmentMetafield(productGid);
      results.push({ productGid, ok: true });
    } catch (e) {
      results.push({ productGid, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    total: results.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results
  });
}