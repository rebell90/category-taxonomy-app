import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// cache on the edge/CDN for 10 minutes
export const revalidate = 600

export async function GET() {
  const rows = await prisma.category.findMany({
    select: { id: true, title: true, slug: true, parentId: true },
    orderBy: { title: 'asc' },
  })
  const byParent = new Map<string|null, any[]>()
  for (const r of rows) {
    const key = r.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push({ id: r.id, title: r.title, slug: r.slug })
  }
  const build = (parentId: string|null): any[] =>
    (byParent.get(parentId) || []).map(n => ({ ...n, children: build(n.id) }))
  return NextResponse.json(build(null))
}