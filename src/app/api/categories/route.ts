// /src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/* =========================
   Types
========================= */

type CategoryRow = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  image: string | null;
  description: string | null;
  // NOTE: we don't have to select the Shopify columns for the admin tree,
  // but we may use them during POST/PUT/DELETE operations.
};

type CategoryNode = CategoryRow & {
  children: CategoryNode[];
};

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

type DeleteBody = {
  id: string;
};

/* =========================
   Optional Shopify sync
========================= */

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_ENABLED = Boolean(SHOP && TOKEN);

// Minimal shape for a Shopify Page response
interface ShopifyPage {
  id: number | string;
  handle?: string;
  title?: string;
  body_html?: string;
}

interface ShopifyPageResponse {
  page?: ShopifyPage;
}

async function shopifyFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  if (!SHOPIFY_ENABLED) {
    // @ts-expect-error - only used when Shopify is configured
    throw new Error('Shopify not configured');
  }
  const url = `https://${SHOP}/admin/api/2024-07${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN as string,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify ${res.status} ${res.statusText} – ${text}`);
  }
  // DELETE often returns an empty body – guard it
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // @ts-expect-error - caller controls expected type
    return undefined;
  }
  return (await res.json()) as T;
}

function categoryToShopifyPagePayload(cat: {
  title: string;
  description: string | null;
}) {
  return {
    page: {
      title: cat.title,
      body_html: cat.description ?? '',
      // You *can* set published: true/false if you want to control visibility
      // published: true,
    },
  };
}

async function ensureShopifyPageForCategory(cat: {
  id: string;
  title: string;
  description: string | null;
  shopifyPageId: string | null;
  slug: string;
}) {
  if (!SHOPIFY_ENABLED) return { id: null as string | null, handle: null as string | null };

  // create or update
  if (cat.shopifyPageId) {
    // Update existing page
    const payload = categoryToShopifyPagePayload(cat);
    const resp = await shopifyFetch<ShopifyPageResponse>(`/pages/${cat.shopifyPageId}.json`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return {
      id: String(resp.page?.id ?? cat.shopifyPageId),
      handle: resp.page?.handle ?? null,
    };
  } else {
    // Create new page
    const payload = categoryToShopifyPagePayload(cat);
    const resp = await shopifyFetch<ShopifyPageResponse>(`/pages.json`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      id: resp.page ? String(resp.page.id) : null,
      handle: resp.page?.handle ?? null,
    };
  }
}

async function deleteShopifyPageById(id: string) {
  if (!SHOPIFY_ENABLED) return;
  await shopifyFetch<void>(`/pages/${id}.json`, { method: 'DELETE' });
}

/* =========================
   Helpers
========================= */

function buildTree(all: CategoryRow[], parentId: string | null): CategoryNode[] {
  return all
    .filter((c) => c.parentId === parentId)
    .map((c) => ({
      ...c,
      children: buildTree(all, c.id),
    }));
}

/* =========================
   Routes
========================= */

// GET: return full tree for the admin UI
export async function GET() {
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
  });

  const tree = buildTree(rows, null);
  return NextResponse.json(tree);
}

// POST: create a category (and optionally create/update Shopify page)
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

    // Try to sync to Shopify (best effort)
    let shopifyPageId: string | null = created.shopifyPageId;
    let shopifyHandle: string | null = created.shopifyHandle;

    if (SHOPIFY_ENABLED) {
      try {
        const res = await ensureShopifyPageForCategory({
          id: created.id,
          title: created.title,
          description: created.description,
          shopifyPageId: created.shopifyPageId,
          slug: created.slug,
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
        // Don’t fail the API if Shopify failed – just log
        console.error('[categories:POST] Shopify sync failed', e);
      }
    }

    return NextResponse.json({
      ...created,
      shopifyPageId,
      shopifyHandle,
    });
  } catch (err) {
    console.error('POST /api/categories error', err);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

// PUT: update a category (and optionally upsert Shopify page)
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateBody;
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const data: Record<string, string | null> & { parentId?: string | null } = {};
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.slug === 'string') data.slug = body.slug;
    if (body.parentId !== undefined) data.parentId = body.parentId;
    if (body.image !== undefined) data.image = body.image ?? null;
    if (body.description !== undefined) data.description = body.description ?? null;

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

    // Try to sync to Shopify (best effort)
    if (SHOPIFY_ENABLED) {
      try {
        const res = await ensureShopifyPageForCategory({
          id: updated.id,
          title: updated.title,
          description: updated.description,
          shopifyPageId: updated.shopifyPageId,
          slug: updated.slug,
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

// DELETE: delete a category (and optionally delete Shopify page)
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteBody;
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // Fetch the record first so we can see shopifyPageId before removal
    const existing = await prisma.category.findUnique({
      where: { id: body.id },
      select: { id: true, shopifyPageId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Best-effort Shopify delete
    if (SHOPIFY_ENABLED && existing.shopifyPageId) {
      try {
        await deleteShopifyPageById(existing.shopifyPageId);
      } catch (e) {
        console.error('[categories:DELETE] Shopify page delete failed', e);
        // Continue anyway, you may opt to stop deletion if you prefer hard consistency
      }
    }

    await prisma.category.delete({ where: { id: body.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/categories error', err);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}