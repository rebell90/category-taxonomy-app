// src/app/api/public/categories/route.ts
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Cache at the edge for 10 minutes (adjust as you like)
export const revalidate = 600

export async function GET() {
  // 1) Load all categories in one query
  const rows = await prisma.category.findMany({
    select: { id: true, title: true, slug: true, parentId: true },
    orderBy: { title: 'asc' },
  })

  // 2) Group by parentId
  const byParent = new Map<string | null, Array<{ id: string; title: string; slug: string }>>()
  for (const r of rows) {
    const key = r.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push({ id: r.id, title: r.title, slug: r.slug })
  }

  // 3) Build tree recursively
  const build = (parentId: string | null): any[] =>
    (byParent.get(parentId) || []).map(n => ({
      ...n,
      children: build(n.id),
    }))

  const tree = build(null)

  // 4) CORS + caching headers so Shopify can fetch it client-side
  const res = NextResponse.json(tree)
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=60')
  return res
}

// Preflight (some browsers send this on cross-origin fetches)
export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 })
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=60')
  return res
}