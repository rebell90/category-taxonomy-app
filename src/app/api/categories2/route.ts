// /src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

type CategoryRow = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image: string | null
  description: string | null
}

type CategoryNode = CategoryRow & {
  children: CategoryNode[]
}

// GET: return full tree for the admin UI
export async function GET() {
  // Always read fresh, include image/description
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
  return NextResponse.json(tree)
}

// POST: create a category
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<CategoryRow>
    const { title, slug } = body

    if (!title || !slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 })
    }

    const created = await prisma.category.create({
      data: {
        title,
        slug,
        parentId: body.parentId ?? null,
        image: body.image ?? null,
        description: body.description ?? null,
      },
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true,
      },
    })

    return NextResponse.json(created)
  } catch (err) {
    console.error('POST /api/categories error', err)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}

// PUT: update a category
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Partial<CategoryRow> & { id?: string }
    const { id } = body
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    if (typeof body.title === 'string') data.title = body.title
    if (typeof body.slug === 'string') data.slug = body.slug
    if (body.parentId !== undefined) data.parentId = body.parentId
    if (body.image !== undefined) data.image = body.image ?? null
    if (body.description !== undefined) data.description = body.description ?? null

    const updated = await prisma.category.update({
      where: { id },
      data,
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true,
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('PUT /api/categories error', err)
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

// DELETE: delete a category (and cascade via your business rules if desired)
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { id?: string }
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Optionally: guard against deleting a category that still has children/products
    await prisma.category.delete({ where: { id: body.id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/categories error', err)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}