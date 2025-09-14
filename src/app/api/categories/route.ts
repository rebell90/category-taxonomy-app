// /src/app/api/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// ---------- Types ----------
type CategoryRow = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  image: string | null;
  description: string | null;
  shopifyPageId?: string | null;
  shopifyHandle?: string | null;
  lastSyncedAt?: Date | null;
};

type CategoryNode = CategoryRow & { children: CategoryNode[] };

// ---------- Shopify helpers ----------
const SHOP = process.env.SHOPIFY_SHOP_URL; // e.g. my-store.myshopify.com
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

function shopifyURL(path: string) {
  if (!SHOP) throw new Error('Missing SHOPIFY_SHOP_URL');
  return `https://${SHOP}/admin/api/2024-07${path}`;
}

async function shopifyFetch(path: string, init?: RequestInit) {
  if (!TOKEN) throw new Error('Missing SHOPIFY_ADMIN_TOKEN/SHOPIFY_ADMIN_ACCESS_TOKEN');
  const res = await fetch(shopifyURL(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
      ...(init?.headers || {}),
    },
    // Render/Next edge: ensure not reusing cookies
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

/** Build HTML body for the Shopify page from a category */
function buildBodyHtml(c: Pick<CategoryRow, 'title'|'description'|'image'|'slug'>) {
  const parts: string[] = [];
  if (c.description) parts.push(`<p>${c.description}</p>`);
  if (c.image) parts.push(`<p><img alt="${c.title || c.slug}" src="${c.image}"/></p>`);
  // you can add more here (links to child cats, etc.)
  return parts.join('\n') || `<p>${c.title}</p>`;
}

/** Create a Shopify page */
async function createShopifyPageForCategory(c: CategoryRow) {
  const body_html = buildBodyHtml(c);
  // Try to use your slug as handle; let Shopify normalize if needed
  const res = await shopifyFetch(`/pages.json`, {
    method: 'POST',
    body: JSON.stringify({
      page: {
        title: c.title,
        body_html,
        handle: c.slug,
        published: true,
      },
    }),
  });

  // shape: { page: { id, handle, ... } }
  const page = res?.page;
  return { id: String(page?.id || ''), handle: String(page?.handle || c.slug) };
}

/** Update an existing Shopify page */
async function updateShopifyPageForCategory(shopifyPageId: string, c: CategoryRow) {
  const body_html = buildBodyHtml(c);
  const res = await shopifyFetch(`/pages/${shopifyPageId}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      page: {
        id: shopifyPageId,
        title: c.title,
        body_html,
        handle: c.slug, // if you want Shopify to attempt to align handle with slug
        published: true,
      },
    }),
  });
  const page = res?.page;
  return { id: String(page?.id || shopifyPageId), handle: String(page?.handle || c.slug) };
}

/** Delete a Shopify page */
async function deleteShopifyPage(shopifyPageId: string) {
  await shopifyFetch(`/pages/${shopifyPageId}.json`, { method: 'DELETE' });
}

/** Ensure Shopify page exists/updated for this Category; then persist IDs on our side */
async function ensureShopifySync(categoryId: string) {
  // Read what we need
  const cat = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id: true, title: true, slug: true, image: true, description: true,
      shopifyPageId: true, shopifyHandle: true,
    },
  });
  if (!cat) throw new Error('Category not found');

  try {
    let pageId = cat.shopifyPageId || null;
    let handle = cat.shopifyHandle || cat.slug;

    if (!pageId) {
      // create new
      const created = await createShopifyPageForCategory(cat as any);
      pageId = created.id;
      handle = created.handle;
    } else {
      // update existing
      const updated = await updateShopifyPageForCategory(pageId, cat as any);
      pageId = updated.id;
      handle = updated.handle;
    }

    await prisma.category.update({
      where: { id: categoryId },
      data: { shopifyPageId: pageId, shopifyHandle: handle, lastSyncedAt: new Date() },
      select: { id: true },
    });
  } catch (err) {
    // Don’t fail the API write—just log. You can make this fatal if you prefer.
    console.warn('[categories] Shopify sync failed for category', categoryId, err);
  }
}

/** Try delete Shopify page but ignore errors */
async function tryDeleteShopifyPageIfLinked(categoryId: string) {
  const cat = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { shopifyPageId: true },
  });
  if (!cat?.shopifyPageId) return;
  try {
    await deleteShopifyPage(cat.shopifyPageId);
  } catch (err) {
    console.warn('[categories] Shopify page delete failed', cat.shopifyPageId, err);
  }
}

// ---------- GET (tree for admin UI) ----------
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
      // helpful to see sync status in your admin UI (optional)
      shopifyPageId: true,
      shopifyHandle: true,
      lastSyncedAt: true,
    },
  });

  const buildTree = (all: CategoryRow[], parentId: string | null): CategoryNode[] =>
    all
      .filter(c => c.parentId === parentId)
      .map(c => ({ ...c, children: buildTree(all, c.id) }));

  return NextResponse.json(buildTree(rows, null));
}

// ---------- POST: create ----------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CategoryRow>;
    const { title, slug } = body;
    if (!title || !slug) {
      return NextResponse.json({ error: 'Title and slug are required' }, { status: 400 });
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
        shopifyPageId: true, shopifyHandle: true, lastSyncedAt: true,
      },
    });

    // best-effort sync to Shopify (won’t block if it fails)
    await ensureShopifySync(created.id);

    // return fresh row (with Shopify fields possibly filled)
    const fresh = await prisma.category.findUnique({
      where: { id: created.id },
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true,
        shopifyPageId: true, shopifyHandle: true, lastSyncedAt: true,
      },
    });

    return NextResponse.json(fresh);
  } catch (err) {
    console.error('POST /api/categories error', err);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

// ---------- PUT: update ----------
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CategoryRow> & { id?: string };
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.slug === 'string') data.slug = body.slug;
    if (body.parentId !== undefined) data.parentId = body.parentId;
    if (body.image !== undefined) data.image = body.image ?? null;
    if (body.description !== undefined) data.description = body.description ?? null;

    const updated = await prisma.category.update({
      where: { id },
      data,
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true,
        shopifyPageId: true, shopifyHandle: true, lastSyncedAt: true,
      },
    });

    // best-effort sync/update in Shopify
    await ensureShopifySync(id);

    const fresh = await prisma.category.findUnique({
      where: { id },
      select: {
        id: true, title: true, slug: true, parentId: true, image: true, description: true,
        shopifyPageId: true, shopifyHandle: true, lastSyncedAt: true,
      },
    });

    return NextResponse.json(fresh);
  } catch (err) {
    console.error('PUT /api/categories error', err);
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
  }
}

// ---------- DELETE ----------
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    // try to remove the mapped Shopify page (best-effort)
    await tryDeleteShopifyPageIfLinked(body.id);

    await prisma.category.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/categories error', err);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}