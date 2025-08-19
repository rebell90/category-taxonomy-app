// src/app/api/categories/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type CategoryRow = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
};

type TreeNode = CategoryRow & {
  // keep placeholders for future fields; always null for now
  image: string | null;
  description: string | null;
  children: TreeNode[];
};

function buildTree(rows: CategoryRow[], parentId: string | null): TreeNode[] {
  return rows
    .filter((r) => r.parentId === parentId)
    .map((r) => ({
      ...r,
      image: null,
      description: null,
      children: buildTree(rows, r.id),
    }));
}

// GET: return nested category tree (no image/description selects)
export async function GET() {
  try {
    const rows = await prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, slug: true, parentId: true },
    });

    const tree = buildTree(rows as CategoryRow[], null);
    return NextResponse.json(tree);
  } catch (e) {
    console.error('GET /api/categories error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST: create a category (ignore image/description if DB doesn’t have them)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string | undefined = body?.title?.trim();
    const slug: string | undefined = body?.slug?.trim();
    const parentId: string | null = body?.parentId || null;

    if (!title || !slug) {
      return NextResponse.json(
        { error: 'Title and slug are required' },
        { status: 400 }
      );
    }

    // Only pass columns we know exist in DB
    const created = await prisma.category.create({
      data: { title, slug, parentId },
      select: { id: true, title: true, slug: true, parentId: true },
    });

    const node: TreeNode = { ...created, image: null, description: null, children: [] };
    return NextResponse.json(node);
  } catch (e: any) {
    console.error('POST /api/categories error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// PUT: update a category (ignore image/description if DB doesn’t have them)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const id: string | undefined = body?.id;
    const title: string | undefined = body?.title?.trim();
    const slug: string | undefined = body?.slug?.trim();
    const parentId: string | null | undefined = body?.parentId ?? undefined;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (typeof title === 'string' && title.length) data.title = title;
    if (typeof slug === 'string' && slug.length) data.slug = slug;
    if (parentId !== undefined) data.parentId = parentId;

    const updated = await prisma.category.update({
      where: { id },
      data,
      select: { id: true, title: true, slug: true, parentId: true },
    });

    const node: TreeNode = { ...updated, image: null, description: null, children: [] };
    return NextResponse.json(node);
  } catch (e: any) {
    console.error('PUT /api/categories error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// DELETE: remove a category
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const id: string | undefined = body?.id;
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/categories error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}