/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/product-metafields.ts
import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify'
import { getSlugsForProduct } from '@/lib/categories'

const UPSERT = `
mutation UpsertCats($ownerId: ID!, $value: String!) {
  metafieldsSet(metafields: [{
    ownerId: $ownerId,
    namespace: "taxonomy",
    key: "category_slugs",
    type: "list.single_line_text_field",
    value: $value
  }]) {
    metafields { id key namespace type }
    userErrors { field message }
  }
}`

export async function rebuildProductCategoryMetafield(productGid: string) {
  const slugs = await getSlugsForProduct(productGid)   // e.g., ["exhaust-systems","downpipes"]
  const value = JSON.stringify(slugs)                  // JSON array string for list.single_line_text_field
  const data = await shopifyAdminGraphQL(UPSERT, { ownerId: productGid, value })
  const errors = (data as any)?.metafieldsSet?.userErrors
  if (errors?.length) {
    throw new Error('Shopify metafieldsSet error: ' + JSON.stringify(errors))
  }
}

export async function rebuildProductFitmentMetafield(productGid: string) {
  // Fetch all fitments for this product
  const rows = await prisma.productFitment.findMany({
    where: { productGid },
    select: { yearFrom: true, yearTo: true, make: true, model: true, trim: true, chassis: true }
  });

  const payload = {
    entries: rows.map(r => ({
      yearFrom: r.yearFrom ?? null,
      yearTo:   r.yearTo   ?? null,
      make:     r.make,
      model:    r.model,
      trim:     r.trim ?? null,
      chassis:  r.chassis ?? null,
    }))
  };

  const MUT = `
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace }
        userErrors { field message }
      }
    }
  `;

  const metafields = [{
    ownerId: productGid,
    namespace: 'fitment',
    key: 'ymm',
    type: 'json',
    value: JSON.stringify(payload)
  }];

  const res = await shopifyAdminGraphQL<{
    metafieldsSet: { userErrors: Array<{ field?: string[]; message: string }> }
  }>(MUT, { metafields });

  const errs = res.metafieldsSet?.userErrors || [];
  if (errs.length) {
    throw new Error(`metafieldsSet userErrors: ${JSON.stringify(errs)}`);
  }
}
export const writeProductFitmentsMetafield = rebuildProductFitmentMetafield;