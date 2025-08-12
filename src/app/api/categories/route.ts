import prisma from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// (Optional) make this route always dynamic to avoid any accidental caching
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { title, slug, parentId } = await req.json()

    if (!title || !slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 })
    }

    const category = await prisma.category.create({
      data: { title, slug, parentId: parentId || null },
    })
    return NextResponse.json(category)
  } catch (err: any) {
    // Prisma unique constraint error
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Slug must be unique' }, { status: 409 })
    }
    // Foreign key (bad parentId) or other DB errors
    return NextResponse.json({ error: err?.message || 'Failed to create category' }, { status: 500 })
  }
}

export async function GET() {
  // Always read fresh
  const categories = await prisma.category.findMany()
  const build = (parentId: string | null) =>
    categories.filter(c => c.parentId === parentId).map(c => ({ ...c, children: build(c.id) }))
  return NextResponse.json(build(null))
}

export async function PUT(req: NextRequest) {
  try {
    const { id, title, slug, parentId } = await req.json()
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const category = await prisma.category.update({
      where: { id },
      data: { title, slug, parentId: parentId ?? undefined },
    })
    return NextResponse.json(category)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Slug must be unique' }, { status: 409 })
    }
    return NextResponse.json({ error: err?.message || 'Failed to update category' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    await prisma.category.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    // If there are children referencing this category, this may fail
    return NextResponse.json({ error: err?.message || 'Failed to delete category' }, { status: 500 })
  }
}