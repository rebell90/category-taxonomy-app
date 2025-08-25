import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

type CountRow = {
  slug: string
  count: number
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const slugs = url.searchParams.getAll('slug')

    if (slugs.length === 0) {
      return NextResponse.json({ error: 'No slugs provided' }, { status: 400, headers: cors })
    }

    // Example: count products by categoryId
    const counts = await prisma.productCategory.groupBy({
      by: ['categoryId'],
      _count: true,
    })

    // Build lookup: categoryId → count
    const idToCount: Record<string, number> = {}
    counts.forEach(c => {
      idToCount[c.categoryId] = c._count
    })

    // Grab matching categories
    const cats = await prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    })

    const results: CountRow[] = cats.map(c => ({
      slug: c.slug,
      count: idToCount[c.id] ?? 0,
    }))

    return NextResponse.json({ results }, { headers: cors })
  } catch (e) {
    console.error('[category-counts] failed', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: cors })
  }
}