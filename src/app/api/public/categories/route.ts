import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function GET(_req: NextRequest) {
  // build your tree as before
  const cats = await prisma.category.findMany()
  const byParent = new Map<string | null, typeof cats>()
  cats.forEach(c => {
    const k = c.parentId ?? null
    const arr = byParent.get(k) ?? []
    arr.push(c)
    byParent.set(k, arr)
  })
  const build = (pid: string | null) =>
    (byParent.get(pid) ?? []).map(c => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      // add image/description if you have them
      children: build(c.id),
    }))

  const data = build(null)
  return NextResponse.json(data, { headers: corsHeaders })
}