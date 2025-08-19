// src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// ---- Types
export type CategoryRecord = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  image: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryNode = Omit<CategoryRecord, 'createdAt' | 'updatedAt'> & {
  children: CategoryNode[];
};

// ---- Helpers
function buildTree(rows: CategoryRecord[], parentId: string | null): CategoryNode[] {
  return rows
    .filter((r) => r.parentId === parentId)
    .map<CategoryNode>((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      parentId: r.parentId,
      image: r.image,
      description: r.description,
      children: buildTree(rows, r.id),
    }));
}

// ---- GET: return full tree
export async function GET() {
  // Always include image & description in the select
  const rows = await prisma.category.findMany({
    orderBy: [{ title: 'asc' }],
    select: {
      id: true,
      title: true,
      slug: true,
      parentId: true,
      image: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const tree = buildTree(rows as CategoryRecord[], null);
  return NextResponse.json(tree);
}

// ---- POST: create a category
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      slug?: string;
      parentId?: string | null;
      image?: string | null;
      description?: string | null;
    };

    const title = (body.title || '').trim();
    const slug = (body.slug || '').trim();
    const parentId = body.parentId ?? null;
    const image = body.image ?? null;
    const description = body.description ?? null;

    if (!title || !slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 });
    }

    // Optional: ensure parent exists if provided
    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 });
    }

    const created = await prisma.category.create({
      data: { title, slug, parentId, image, description },
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true, createdAt: true, updatedAt: true,
      },
    });

    return NextResponse.json(created);
  } catch (err) {
    console.error('POST /api/categories error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ---- PUT: update a category
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: string;
      title?: string;
      slug?: string;
      parentId?: string | null;
      image?: string | null;
      description?: string | null;
    };

    const id = body.id?.trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    // Validate parent if provided (and not self)
    if (typeof body.parentId !== 'undefined' && body.parentId) {
      if (body.parentId === id) {
        return NextResponse.json({ error: 'Category cannot be its own parent' }, { status: 400 });
      }
      const parent = await prisma.category.findUnique({ where: { id: body.parentId }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 });
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        slug: typeof body.slug === 'string' ? body.slug.trim() : undefined,
        parentId: typeof body.parentId === 'undefined' ? undefined : body.parentId,
        image: typeof body.image === 'undefined' ? undefined : body.image,
        description: typeof body.description === 'undefined' ? undefined : body.description,
      },
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true, createdAt: true, updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error('PUT /api/categories error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ---- DELETE: delete a category (and optionally re-parent or cascade)
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    // Optional: prevent delete if it has children
    const childCount = await prisma.category.count({ where: { parentId: id } });
    if (childCount > 0) {
      return NextResponse.json({ error: 'Delete or re-parent children first' }, { status: 400 });
    }

    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/categories error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}