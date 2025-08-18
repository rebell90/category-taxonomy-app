// src/app/api/public/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

type Cat = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image: string | null
  description: string | null
}
type CatNode = Cat & { children: CatNode[] }

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
  // (optional) allow CDN/browser caching
  'Cache-Control': 'public, max-age=300, s-maxage=300',
}

function buildTree(all: Cat[], parentId: string | null): CatNode[] {
  return all
    .filter(c => c.parentId === parentId)
    .map<CatNode>(c => ({
      ...c,
      children: buildTree(all, c.id),
    }))
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function GET(_req: NextRequest) {
  try {
    const rows = await prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true,
      },
    })
    const tree = buildTree(rows, null)
    return NextResponse.json({ categories: tree }, { headers: corsHeaders })
  } catch (e) {
    // Return a JSON error with CORS so the browser can read it
    return NextResponse.json(
      { error: 'failed_to_load_categories', detail: String(e) },
      { status: 500, headers: corsHeaders },
    )
  }
}