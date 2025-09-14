// scripts/backfillCategoryPages.ts
import prisma from '@/lib/prisma';
import { adminFetch } from '@/lib/shopify-admin';

async function run() {
  const shop = process.env.SHOP!;
  const token = process.env.SHOPIFY_ACCESS_TOKEN!;

  const cats = await prisma.category.findMany();
  for (const c of cats) {
    const handle = c.slug; // adjust if your handle mapping differs
    const res = await adminFetch<{ pages: { id: number; handle: string }[] }>(
      shop, token, `/pages.json?handle=${encodeURIComponent(handle)}`
    );
    const page = res.pages?.[0];
    if (page) {
      await prisma.category.update({
        where: { id: c.id },
        data: {
          shopifyPageId: String(page.id),
          shopifyHandle: page.handle,
          lastSyncedAt: new Date(),
        },
      });
      console.log('Backfilled', c.slug, '→', page.id, page.handle);
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });