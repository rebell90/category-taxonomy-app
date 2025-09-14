// /src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { shopifyAdminREST } from '@/lib/shopify';

/* =========================
   Types (align with Prisma)
========================= */

type CategoryRow = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  image: string | null;     // <— ensure this matches your Prisma model
  description: string | null;
};

type CategoryNode = CategoryRow & { children: CategoryNode[] };

type CreateBody = {
  title: string;
  slug: string;
  parentId?: string | null;
  image?: string | null;
  description?: string | null;
};

type UpdateBody = {
  id: string;
  title?: string;
  slug?: string;
  parentId?: string | null;
  image?: string | null;
  description?: string | null;
};

type DeleteBody = { id: string };

/* =========================
   Shopify helpers
========================= */

const SHOPIFY_ENABLED = Boolean(
  process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ADMIN_TOKEN
);

interface ShopifyPageShape {
  id: number | string;
  handle?: string;
  title?: string;
  body_html?: string;
}
interface ShopifyCreateUpdateResp {
  page?: ShopifyPageShape;
}

function categoryToShopifyPagePayload(cat: {
  title: string;
  description: string | null;
  slug: string;
}) {
  return {
    page: {
      title: cat.title,
      body_html: cat.description ?? '',
      handle: cat.slug, // keep Shopify handle in sync with your slug
      published: true,
    },
  };
}

async function ensureShopifyPageForCategory(cat: {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  shopifyPageId: string | null;
}): Promise<{ id: string | null; handle: string | null }> {
  if (!SHOPIFY_ENABLED) return { id: null, handle: null };

  const payload = categoryToShopifyPagePayload(cat);

  // Update existing page
  if (cat.shopifyPageId) {
    const resp = await shopifyAdminREST<ShopifyCreateUpdateResp>(
      `/pages/${encodeURIComponent(cat.shopifyPageId)}.json`,
      { method: 'PUT', body: JSON.stringify(payload) }
    );
    return {
      id: resp.page ? String(resp.page.id) : cat.shopifyPageId,
      handle: resp.page?.handle ?? null,
    };
  }

  // Create new page
  const resp = await shopifyAdminREST<ShopifyCreateUpdateResp>(
    `/pages.json`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
  return {
    id: resp.page ? String(resp.page.id) : null,
    handle: resp.page?.handle ?? null,
  };
}

async function deleteShopifyPageById(pageId: string): Promise<void> {
  if (!SHOPIFY_ENABLED) return;
  await shopifyAdminREST<void>(`/pages/${encodeURIComponent(pageId)}.json`, {
    method: 'DELETE',
  });
}

/* =========================
   Local helpers
========================= */

function buildTree(all: CategoryRow[], parentId: string | null): CategoryNode[] {
  return all
    .filter((c) => c.parentId === parentId)
    .map((c) => ({ ...c, children: buildTree(all, c.id) }));
}

/* =========================
   Routes
========================= */

// GET: full tree for admin UI
export async function GET() {
  const rows = await prisma.category.findMany({
    orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
    select: {
      id: true,
      title: true,
      slug: true,
      parentId: true,
      image: true,      // <— keep consistent with model
      description: true,
    },
  });

  const tree = buildTree(rows, null);
  return NextResponse.json(tree);
}

// POST: create category (+ optional Shopify page upsert)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;

    if (!body.title || !body.slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 });
    }

    const created = await prisma.category.create({
      data: {
        title: body.title,
        slug: body.slug,
        parentId: body.parentId ?? null,
        image: body.image ?? null,
        description: body.description ?? null,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        parentId: true,
        image: true,
        description: true,
        shopifyPageId: true,
        shopifyHandle: true,
      },
    });

    let shopifyPageId = created.shopifyPageId;
    let shopifyHandle = created.shopifyHandle;

    if (SHOPIFY_ENABLED) {
      try {
        const res = await ensureShopifyPageForCategory({
          id: created.id,
          title: created.title,
          description: created.description,
          slug: created.slug,
          shopifyPageId: created.shopifyPageId,
        });

        if (res.id || res.handle) {
          const saved = await prisma.category.update({
            where: { id: created.id },
            data: {
              shopifyPageId: res.id,
              shopifyHandle: res.handle,
              lastSyncedAt: new Date(),
            },
            select: { shopifyPageId: true, shopifyHandle: true },
          });
          shopifyPageId = saved.shopifyPageId;
          shopifyHandle = saved.shopifyHandle;
        }
      } catch (e) {
        console.error('[categories:POST] Shopify sync failed', e);
      }
    }

    return NextResponse.json({ ...created, shopifyPageId, shopifyHandle });
  } catch (err) {
    console.error('POST /api/categories error', err);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

// PUT: update category (+ optional Shopify page upsert)
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateBody;
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // Build partial update data
    const data: {
      title?: string;
      slug?: string;
      parentId?: string | null;
      image?: string | null;
      description?: string | null;
    } = {};
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.slug === 'string') data.slug = body.slug;
    if (body.parentId !== undefined) data.parentId = body.parentId;
    if (body.image !== undefined) data.image = body.image;
    if (body.description !== undefined) data.description = body.description;

    const updated = await prisma.category.update({
      where: { id: body.id },
      data,
      select: {
        id: true,
        title: true,
        slug: true,
        parentId: true,
        image: true,
        description: true,
        shopifyPageId: true,
        shopifyHandle: true,
      },
    });

    if (SHOPIFY_ENABLED) {
      try {
        const res = await ensureShopifyPageForCategory({
          id: updated.id,
          title: updated.title,
          description: updated.description,
          slug: updated.slug,
          shopifyPageId: updated.shopifyPageId,
        });

        if (res.id || res.handle) {
          const saved = await prisma.category.update({
            where: { id: updated.id },
            data: {
              shopifyPageId: res.id,
              shopifyHandle: res.handle,
              lastSyncedAt: new Date(),
            },
            select: {
              id: true,
              title: true,
              slug: true,
              parentId: true,
              image: true,
              description: true,
              shopifyPageId: true,
              shopifyHandle: true,
              lastSyncedAt: true,
            },
          });
          return NextResponse.json(saved);
        }
      } catch (e) {
        console.error('[categories:PUT] Shopify sync failed', e);
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('PUT /api/categories error', err);
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
  }
}

// DELETE: delete category (+ optional Shopify page delete)
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteBody;
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // Read first so we have the page id before removal
    const existing = await prisma.category.findUnique({
      where: { id: body.id },
      select: { id: true, shopifyPageId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (SHOPIFY_ENABLED && existing.shopifyPageId) {
      try {
        await deleteShopifyPageById(existing.shopifyPageId);
      } catch (e) {
        console.error('[categories:DELETE] Shopify page delete failed', e);
        // continue anyway
      }
    }

    await prisma.category.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/categories error', err);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}