/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/product-metafields.ts
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