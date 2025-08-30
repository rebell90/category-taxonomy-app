// /src/app/api/public/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

type CategoryRow = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image: string | null
  description: string | null
}

type CategoryNode = CategoryRow & { children: CategoryNode[] }

export async function GET(_req: NextRequest) {
  try {
    const rows: CategoryRow[] = await prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        parentId: true,
        image: true,
        description: true,
      },
    })

    const buildTree = (all: CategoryRow[], parentId: string | null): CategoryNode[] =>
      all
        .filter((c) => c.parentId === parentId)
        .map((c) => ({
          ...c,
          children: buildTree(all, c.id),
        }))

    const tree = buildTree(rows, null)
    return NextResponse.json({ tree }, { headers: corsHeaders })
  } catch (err) {
    console.error('GET /api/public/categories error', err)
    return NextResponse.json({ error: 'Failed to load categories' }, { status: 500, headers: corsHeaders })
  }
}