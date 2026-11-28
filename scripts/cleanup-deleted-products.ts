#!/usr/bin/env tsx
// One-time cleanup: remove category/fitment assignments for products that no
// longer exist in Shopify.
//
// Usage:
//   npx tsx scripts/cleanup-deleted-products.ts          # dry run
//   npx tsx scripts/cleanup-deleted-products.ts --commit  # write changes

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--commit');

const SHOPIFY_STORE   = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const API_VERSION     = '2026-10';

async function shopifyProductExists(gid: string): Promise<boolean> {
  const id = gid.replace('gid://shopify/Product/', '');
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/products/${id}.json?fields=id`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
  });
  return res.status === 200;
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be written.\n' : '✍️  COMMIT MODE — changes will be written.\n');

  // Collect all unique product GIDs with assignments
  const [catGids, fitGids] = await Promise.all([
    prisma.productCategory.findMany({ select: { productGid: true }, distinct: ['productGid'] }),
    prisma.productFitment.findMany({ select: { productGid: true }, distinct: ['productGid'] }),
  ]);

  const allGids = [...new Set([
    ...catGids.map(r => r.productGid),
    ...fitGids.map(r => r.productGid),
  ])];

  console.log(`Found ${allGids.length} unique product GIDs with assignments. Checking Shopify...\n`);

  const deleted: string[] = [];

  for (const gid of allGids) {
    const exists = await shopifyProductExists(gid);
    if (!exists) {
      deleted.push(gid);
      console.log(`  ✗ DELETED: ${gid}`);
    }
    // small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n${deleted.length} deleted product(s) found.\n`);

  if (deleted.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  if (DRY_RUN) {
    console.log('Run with --commit to remove their assignments.');
    return;
  }

  for (const gid of deleted) {
    const [cats, fits] = await Promise.all([
      prisma.productCategory.deleteMany({ where: { productGid: gid } }),
      prisma.productFitment.deleteMany({ where: { productGid: gid } }),
    ]);
    console.log(`  Removed ${cats.count} category + ${fits.count} fitment rows for ${gid}`);
  }

  console.log('\n✅ Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
