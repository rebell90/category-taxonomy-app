import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
} as const

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

// Row from your Prisma Category table (extend if you added fields)
type DBCategory = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image?: string | null
  description?: string | null
}

// Public JSON shape this endpoint returns
export type PublicCategory = {
  id: string
  slug: string
  title: string
  image?: string | null
  description?: string | null
  children: PublicCategory[]
}

export async function GET(_req: NextRequest) {
  try {
    // Always read fresh
    const cats: DBCategory[] = await prisma.category.findMany({
      orderBy: { title: 'asc' },
    })

    // Group by parentId for O(n) tree build
    const byParent = new Map<string | null, DBCategory[]>()
    for (const c of cats) {
      const key = c.parentId ?? null
      const arr = byParent.get(key)
      if (arr) arr.push(c)
      else byParent.set(key, [c])
    }

    // Recursive builder with explicit return type
    const build = (parentId: string | null): PublicCategory[] => {
      const children = byParent.get(parentId) ?? []
      return children.map<PublicCategory>((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        image: c.image ?? null,
        description: c.description ?? null,
        children: build(c.id),
      }))
    }

    const tree: PublicCategory[] = build(null)
    return NextResponse.json(tree, { headers: corsHeaders })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load categories' },
      { status: 500, headers: corsHeaders }
    )
  }
}