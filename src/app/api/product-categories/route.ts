import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { rebuildProductCategoryMetafield } from '@/lib/product-metafields'

// test errors
const log = (...args: unknown[]) => {
  // Render/Next will show this in server logs
  console.log('[product-categories]', ...args)
}

// --- helpers ---------------------------------------------------------------

function normalizeProductGid(idOrGid: string): string {
  if (!idOrGid) return idOrGid
  if (idOrGid.startsWith('gid://shopify/Product/')) return idOrGid
  // If numeric or string of digits, coerce to GID
  if (/^\d+$/.test(idOrGid)) return `gid://shopify/Product/${idOrGid}`
  return idOrGid
}

async function idsFromSlugs(slugs: string[]): Promise<string[]> {
  if (!slugs.length) return []
  const found = await prisma.category.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  })
  return found.map(c => c.id)
}

async function linkCategories(
  productGid: string,
  categoryIds: string[],
  replaceExisting: boolean
): Promise<{ added: number; removed: number }> {
  const unique = Array.from(new Set(categoryIds))
  let removed = 0
  let added = 0

  if (replaceExisting) {
    // wipe and set exactly these
    const del = await prisma.productCategory.deleteMany({ where: { productGid } })
    removed = del.count
    if (unique.length) {
      const created = await prisma.productCategory.createMany({
        data: unique.map(categoryId => ({ productGid, categoryId })),
        skipDuplicates: true,
      })
      added = created.count
    }
    return { added, removed }
  }

  // Append only the missing ones
  const existing = await prisma.productCategory.findMany({
    where: { productGid, categoryId: { in: unique } },
    select: { categoryId: true },
  })
  const existingSet = new Set(existing.map(e => e.categoryId))
  const toAdd = unique.filter(id => !existingSet.has(id))
  if (toAdd.length) {
    const created = await prisma.productCategory.createMany({
      data: toAdd.map(categoryId => ({ productGid, categoryId })),
      skipDuplicates: true,
    })
    added = created.count
  }
  return { added, removed: 0 }
}

// --- POST: assign (flexible payloads) --------------------------------------
/*
Accepts ANY of the shapes below:

1) Single ID pair
   { "productGid": "gid://shopify/Product/123", "categoryId": "cat_cuid", "replaceExisting": false }

2) Bulk IDs
   { "productGid": "gid://shopify/Product/123", "categoryIds": ["cat_cuid", ...], "replaceExisting": true }

3) Using productId alias and/or numeric product id
   { "productId": "123", "categoryIds": ["cat_cuid"] }

4) Using slugs (we will resolve to IDs)
   { "productGid": "gid://shopify/Product/123", "slugs": ["exhaust-systems","headers"], "replaceExisting": false }

5) Legacy shape from earlier UI
   { "productId": "gid://shopify/Product/123", "slugs": ["some-slug"] }
*/
export async function POST(req: NextRequest) {
  //const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const raw = await req.text()
  log('POST raw body:', raw)
  let body: any
  try { body = JSON.parse(raw) } catch { body = {} }
  log('POST parsed:', body)
  // Normalize product GID
  const rawProduct: string =
    (body as any).productGid ?? (body as any).productId ?? ''
  const productGid = normalizeProductGid(String(rawProduct || ''))

  // Gather category IDs from various shapes
  const replaceExisting: boolean = Boolean((body as any).replaceExisting)
  const directCatId: string | undefined = (body as any).categoryId
  const directCatIds: string[] | undefined = (body as any).categoryIds
  const slugs: string[] | undefined = (body as any).slugs

  if (!productGid) {
    return NextResponse.json(
      { error: 'Missing productGid/productId' },
      { status: 400 }
    )
  }

  let categoryIds: string[] = []

  if (directCatId) categoryIds.push(String(directCatId))
  if (Array.isArray(directCatIds) && directCatIds.length) {
    categoryIds.push(...directCatIds.map(String))
  }
  if (Array.isArray(slugs) && slugs.length) {
    const resolved = await idsFromSlugs(slugs.map(String))
    categoryIds.push(...resolved)
  }

  categoryIds = Array.from(new Set(categoryIds))

  if (!categoryIds.length) {
    return NextResponse.json(
      { error: 'Missing categoryId/categoryIds or slugs' },
      { status: 400 }
    )
  }

  // Link them
  const { added, removed } = await linkCategories(productGid, categoryIds, replaceExisting)

  // Rebuild the metafield to reflect the current DB
  await rebuildProductCategoryMetafield(productGid)

  return NextResponse.json({
    ok: true,
    productGid,
    categoryIds,
    replaceExisting,
    added,
    removed,
  })
}

// --- DELETE: unlink (accept id or slug) ------------------------------------
/*
Accepts:
  { "productGid": "...", "categoryId": "cat_cuid" }
or
  { "productId": "123", "slug": "exhaust-systems" }
*/
export async function DELETE(req: NextRequest) {
  //const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const raw = await req.text()
  log('DELETE raw body:', raw)
  const rawProduct: string =
    (body as any).productGid ?? (body as any).productId ?? ''
  const productGid = normalizeProductGid(String(rawProduct || ''))

  if (!productGid) {
    return NextResponse.json(
      { error: 'Missing productGid/productId' },
      { status: 400 }
    )
  }

  let categoryId: string | null = (body as any).categoryId ?? null

  const slug: string | undefined = (body as any).slug
  if (!categoryId && slug) {
    const found = await prisma.category.findUnique({
      where: { slug: String(slug) },
      select: { id: true },
    })
    categoryId = found?.id ?? null
  }

  if (!categoryId) {
    return NextResponse.json(
      { error: 'Missing categoryId or resolvable slug' },
      { status: 400 }
    )
  }

  await prisma.productCategory.delete({
    where: { productGid_categoryId: { productGid, categoryId: String(categoryId) } },
  })

  await rebuildProductCategoryMetafield(productGid)

  return NextResponse.json({ success: true })
}