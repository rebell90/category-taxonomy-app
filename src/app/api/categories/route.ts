// src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

type CategoryRecord = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image: string | null
  description: string | null
}

type CategoryNode = CategoryRecord & {
  children: CategoryNode[]
}

/** Build a nested tree from a flat list. */
function buildTree(all: CategoryRecord[], parentId: string | null): CategoryNode[] {
  return all
    .filter(c => c.parentId === parentId)
    .map<CategoryNode>(c => ({
      ...c,
      children: buildTree(all, c.id),
    }))
}

/** Simple slug guard (keeps your existing style; accepts dashes). */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

/** Make sure we never cache these API responses */
const noStore = {
  'Cache-Control': 'no-store, must-revalidate',
}

export async function GET(): Promise<NextResponse<CategoryNode[]>> {
  const categories = await prisma.category.findMany({
    orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
  })
  const flat: CategoryRecord[] = categories.map(c => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    parentId: c.parentId,
    image: c.image ?? null,
    description: c.description ?? null,
  }))
  const tree = buildTree(flat, null)
  return NextResponse.json(tree, { headers: noStore })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      title?: string
      slug?: string
      parentId?: string | null
      image?: string | null
      description?: string | null
    }

    const title = (body.title ?? '').trim()
    const slug = (body.slug ?? '').trim()
    const parentId = body.parentId ?? null
    const image = body.image ? String(body.image).trim() : null
    const description = body.description ? String(body.description).trim() : null

    if (!title || !slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 })
    }
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: 'Slug must be lowercase letters/numbers with dashes' }, { status: 400 })
    }

    // Ensure slug is unique
    const exists = await prisma.category.findUnique({ where: { slug } })
    if (exists) {
      return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
    }

    // Validate parent if provided
    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId } })
      if (!parent) {
        return NextResponse.json({ error: 'Parent not found' }, { status: 400 })
      }
    }

    const created = await prisma.category.create({
      data: { title, slug, parentId, image, description },
    })

    return NextResponse.json(created, { status: 201, headers: noStore })
  } catch (err) {
    console.error('POST /api/categories error', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      id?: string
      title?: string
      slug?: string
      image?: string | null
      description?: string | null
    }
    const id = body.id?.trim()
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // Fetch existing
    const existing = await prisma.category.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const data: Partial<CategoryRecord> = {}

    if (typeof body.title === 'string') {
      const t = body.title.trim()
      if (!t) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
      data.title = t
    }

    if (typeof body.slug === 'string') {
      const s = body.slug.trim()
      if (!s) return NextResponse.json({ error: 'Slug cannot be empty' }, { status: 400 })
      if (!isValidSlug(s)) {
        return NextResponse.json({ error: 'Slug must be lowercase letters/numbers with dashes' }, { status: 400 })
      }
      if (s !== existing.slug) {
        const clash = await prisma.category.findUnique({ where: { slug: s } })
        if (clash) {
          return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
        }
      }
      data.slug = s
    }

    if (body.image !== undefined) {
      data.image = body.image ? String(body.image).trim() : null
    }
    if (body.description !== undefined) {
      data.description = body.description ? String(body.description).trim() : null
    }

    const updated = await prisma.category.update({
      where: { id },
      data,
    })

    return NextResponse.json(updated, { headers: noStore })
  } catch (err) {
    console.error('PUT /api/categories error', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { id?: string }
    const id = body.id?.trim()
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    // If this node has children, reparent them to top-level to avoid losing subtrees.
    await prisma.category.updateMany({
      where: { parentId: id },
      data: { parentId: null },
    })

    await prisma.category.delete({ where: { id } })
    return NextResponse.json({ success: true }, { headers: noStore })
  } catch (err) {
    console.error('DELETE /api/categories error', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}