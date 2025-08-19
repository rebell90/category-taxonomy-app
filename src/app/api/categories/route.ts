/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Minimal on-wire types:
type CategoryPayload = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  image: string | null;        // may be null if DB doesn’t have the column yet
  description: string | null;  // may be null if DB doesn’t have the column yet
};

// Try a query and if we hit P2022 (missing column) run the fallback
async function tryWithFallback<T>(
  attempt: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  try {
    return await attempt();
  } catch (err: any) {
    // P2022: “The column <X> does not exist in the current database.”
    if (err?.code === 'P2022' || /does not exist in the current database/i.test(String(err?.message))) {
      return await fallback();
    }
    throw err;
  }
}

// Build tree
function buildTree(rows: CategoryPayload[], parentId: string | null): CategoryPayload[] & { children: any[] } {
  return rows
    .filter((r) => r.parentId === parentId)
    .map((r) => ({
      ...r,
      children: buildTree(rows, r.id),
    })) as any;
}

/* ---------------------- GET: full tree ---------------------- */
export async function GET() {
  // Attempt selecting image/description; fallback to selecting without
  const rows = await tryWithFallback<any[]>(
    async () => {
      const list = await prisma.category.findMany({
        orderBy: [{ title: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          parentId: true,
          image: true,        // may explode if column not in DB
          description: true,  // may explode if column not in DB
        },
      });
      return list.map((c: any): CategoryPayload => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        parentId: c.parentId,
        image: c.image ?? null,
        description: c.description ?? null,
      }));
    },
    async () => {
      // Fallback: DB doesn’t have the columns — select only the basics
      const list = await prisma.category.findMany({
        orderBy: [{ title: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          parentId: true,
        },
      });
      return list.map((c: any): CategoryPayload => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        parentId: c.parentId,
        image: null,
        description: null,
      }));
    }
  );

  const tree = buildTree(rows, null);
  return NextResponse.json(tree);
}

/* ---------------------- POST: create ---------------------- */
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

    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 });
    }

    // Try writing image/description; fallback to ignoring those keys if columns don’t exist
    const created = await tryWithFallback<any>(
      async () =>
        prisma.category.create({
          data: { title, slug, parentId, image, description },
          select: { id: true, title: true, slug: true, parentId: true, image: true, description: true },
        }),
      async () =>
        prisma.category.create({
          data: { title, slug, parentId }, // fallback: no image/description
          select: { id: true, title: true, slug: true, parentId: true },
        })
    );

    // Normalize shape for client
    const out: CategoryPayload = {
      id: created.id,
      title: created.title,
      slug: created.slug,
      parentId: created.parentId ?? null,
      image: created.image ?? null,
      description: created.description ?? null,
    };

    return NextResponse.json(out);
  } catch (err) {
    console.error('POST /api/categories error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/* ---------------------- PUT: update ---------------------- */
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

    const id = (body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    if (typeof body.parentId !== 'undefined' && body.parentId) {
      if (body.parentId === id) {
        return NextResponse.json({ error: 'Category cannot be its own parent' }, { status: 400 });
      }
      const parent = await prisma.category.findUnique({ where: { id: body.parentId }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 });
    }

    const dataFull: any = {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      slug: typeof body.slug === 'string' ? body.slug.trim() : undefined,
      parentId: typeof body.parentId === 'undefined' ? undefined : body.parentId,
      image: typeof body.image === 'undefined' ? undefined : body.image,
      description: typeof body.description === 'undefined' ? undefined : body.description,
    };
    const dataNoExtras: any = {
      title: dataFull.title,
      slug: dataFull.slug,
      parentId: dataFull.parentId,
    };

    const updated = await tryWithFallback<any>(
      async () =>
        prisma.category.update({
          where: { id },
          data: dataFull, // may fail if image/description columns don’t exist
          select: { id: true, title: true, slug: true, parentId: true, image: true, description: true },
        }),
      async () =>
        prisma.category.update({
          where: { id },
          data: dataNoExtras, // fallback: ignore image/description
          select: { id: true, title: true, slug: true, parentId: true },
        })
    );

    const out: CategoryPayload = {
      id: updated.id,
      title: updated.title,
      slug: updated.slug,
      parentId: updated.parentId ?? null,
      image: updated.image ?? null,
      description: updated.description ?? null,
    };

    return NextResponse.json(out);
  } catch (err) {
    console.error('PUT /api/categories error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/* ---------------------- DELETE ---------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = (body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

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