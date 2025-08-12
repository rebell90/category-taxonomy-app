/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { rebuildProductCategoryMetafield } from '@/lib/product-metafields'

export const dynamic = 'force-dynamic'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-backfill-secret') || req.nextUrl.searchParams.get('secret')
  if (!auth || auth !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get distinct product GIDs that have at least one category link
  const distinct = await prisma.productCategory.findMany({
    distinct: ['productGid'],
    select: { productGid: true },
    orderBy: { productGid: 'asc' },
  })

  let ok = 0
  const fails: { productGid: string; error: string }[] = []

  // Keep it gentle on Shopify rate limits: sequential with a tiny delay
  for (const row of distinct) {
    try {
      await rebuildProductCategoryMetafield(row.productGid)
      ok++
      await sleep(250) // ~4/sec, safe for Admin API
    } catch (e: any) {
      fails.push({ productGid: row.productGid, error: e?.message || 'unknown error' })
      // small delay even on failure
      await sleep(250)
    }
  }

  return NextResponse.json({
    totalProducts: distinct.length,
    updated: ok,
    failed: fails.length,
    failures: fails, // remove if noisy
  })
}

export async function GET(req: NextRequest) {
  // small status/preview endpoint
  const auth = req.headers.get('x-backfill-secret') || req.nextUrl.searchParams.get('secret')
  if (!auth || auth !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const count = await prisma.productCategory.groupBy({
    by: ['productGid'],
    _count: { productGid: true },
  })

  return NextResponse.json({
    linkedProducts: count.length,
    hint: 'POST to this same URL to run the backfill',
  })
}