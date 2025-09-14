// scripts/backfillCategoryPages.ts
import prisma from '@/lib/prisma';
import {
  shopifyAdminGraphQL,
  shopifyAdminREST,
  findPageIdByHandle,
} from '@/lib/shopify';

type PageCreateResponse = { page: { id: number; handle: string } };
type Gid = `gid://shopify/Page/${string}`;

async function pageByGID(gid: string) {
  const QUERY = /* GraphQL */ `
    query PageNode($id: ID!) {
      node(id: $id) {
        ... on Page { id handle title }
      }
    }
  `;
  const data = await shopifyAdminGraphQL<{ node: { id: string; handle: string } | null }>(
    QUERY,
    { id: gid }
  );
  return data.node as { id: Gid; handle: string } | null;
}

async function createPageForHandle(title: string, handle: string, body_html: string) {
  const payload = {
    page: {
      title,
      handle,           // request this handle
      body_html,
      published: true,
      // template_suffix: 'category', // uncomment if you have page.category.liquid
    },
  };
  const res = await shopifyAdminREST<PageCreateResponse>('/pages.json', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.page;
}

async function run() {
  // Make sure env vars exist where you run this:
  // SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN, (optional) SHOPIFY_ADMIN_API_VERSION
  const cats = await prisma.category.findMany({
    select: { id: true, slug: true, title: true, description: true, shopifyPageId: true, shopifyHandle: true },
    orderBy: { slug: 'asc' },
  });

  let created = 0;
  let backfilled = 0;

  for (const c of cats) {
    const handle = c.slug; // adjust if your page handle differs

    // 1) Try to find an existing page by handle → GraphQL-ID if found
    let gid = await findPageIdByHandle(handle);

    // 2) If not found, create the page via REST
    if (!gid) {
      const html = c.description ? `<p>${c.description}</p>` : '';
      const page = await createPageForHandle(c.title || handle, handle, html);
      gid = `gid://shopify/Page/${page.id}`;
      created++;
      console.log('Created page', handle, '→', page.id, page.handle);
    } else {
      backfilled++;
      // Optional: sanity fetch to confirm handle we’ll store
      const node = await pageByGID(gid);
      if (!node) {
        console.warn('Found GID but could not load node for', handle);
      }
    }

    // 3) Persist to Category
    const numericId = gid.split('/').pop()!;
    const node = await pageByGID(gid);
    await prisma.category.update({
      where: { id: c.id },
      data: {
        shopifyPageId: numericId,
        shopifyHandle: node?.handle ?? c.shopifyHandle ?? handle,
        lastSyncedAt: new Date(),
      },
    });
  }

  console.log(`Done. ${backfilled} backfilled, ${created} created.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});