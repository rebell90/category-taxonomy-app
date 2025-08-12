/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type DbCategory = {
  id: string
  title: string
  slug: string
  parentId: string | null
}

type TreeCategory = DbCategory & {
  children: TreeCategory[]
}

/* ======================
   CREATE
====================== */
export async function POST(req: NextRequest) {
  try {
    const { title, slug, parentId } = (await req.json()) as {
      title?: string
      slug?: string
      parentId?: string | null
    }

    if (!title || !slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 })
    }

    const category = await prisma.category.create({
      data: { title, slug, parentId: parentId ?? null },
    })

    return NextResponse.json(category)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Slug must be unique' }, { status: 409 })
    }
    return NextResponse.json({ error: err?.message || 'Failed to create category' }, { status: 500 })
  }
}

/* ======================
   READ (TREE)
====================== */
export async function GET() {
  const categories: DbCategory[] = await prisma.category.findMany({
    select: { id: true, title: true, slug: true, parentId: true },
    orderBy: { title: 'asc' },
  })

  function build(parentId: string | null): TreeCategory[] {
    return categories
      .filter((c) => c.parentId === parentId)
      .map<TreeCategory>((c) => ({
        ...c,
        children: build(c.id),
      }))
  }

  const tree = build(null)
  return NextResponse.json(tree)
}

/* ======================
   UPDATE
====================== */
export async function PUT(req: NextRequest) {
  try {
    const { id, title, slug, parentId } = (await req.json()) as {
      id?: string
      title?: string
      slug?: string
      parentId?: string | null
    }

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      },
    })

    return NextResponse.json(category)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Slug must be unique' }, { status: 409 })
    }
    return NextResponse.json({ error: err?.message || 'Failed to update category' }, { status: 500 })
  }
}

/* ======================
   DELETE
====================== */
export async function DELETE(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    await prisma.category.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete category' }, { status: 500 })
  }
}