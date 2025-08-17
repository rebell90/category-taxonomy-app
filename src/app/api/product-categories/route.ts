import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { rebuildProductCategoryMetafield } from '@/lib/product-metafields'

// ---------- Types ----------
type AssignBody = {
  productGid?: string
  productId?: string // may be numeric or a gid
  categoryId?: string
  categoryIds?: string[]
  slugs?: string[]
  replaceExisting?: boolean
}

type DeleteBody = {
  productGid?: string
  productId?: string
  categoryId?: string
  slug?: string
}

type LinkResult = { added: number; removed: number }

// ---------- Helpers ----------
function normalizeProductGid(idOrGid: string): string {
  if (!idOrGid) return idOrGid
  if (idOrGid.startsWith('gid://shopify/Product/')) return idOrGid
  // numeric id → wrap as GID
  if (/^\d+$/.test(idOrGid)) return `gid://shopify/Product/${idOrGid}`
  return idOrGid
}

async function idsFromSlugs(slugs: string[]): Promise<string[]> {
  if (!slugs.length) return []
  const found = await prisma.category.findMany({
    where: { slug: { in: slugs } },
    select: { id: true },
  })
  return found.map(c => c.id)
}

async function linkCategories(
  productGid: string,
  categoryIds: string[],
  replaceExisting: boolean
): Promise<LinkResult> {
  const unique = Array.from(new Set(categoryIds))
  let removed = 0
  let added = 0

  if (replaceExisting) {
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

  // Append only missing
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

// ---------- POST (assign) ----------
export async function POST(req: NextRequest) {
  // Read & type body
  const body = (await req.json()) as AssignBody

  // Normalize product
  const rawProduct = body.productGid ?? body.productId ?? ''
  const productGid = normalizeProductGid(String(rawProduct || ''))
  if (!productGid) {
    return NextResponse.json(
      { error: 'Missing productGid/productId' },
      { status: 400 }
    )
  }

  // Collect categories
  const replaceExisting = Boolean(body.replaceExisting)
  const categoryIds: string[] = []

  if (body.categoryId) categoryIds.push(String(body.categoryId))
  if (Array.isArray(body.categoryIds)) {
    for (const id of body.categoryIds) categoryIds.push(String(id))
  }
  if (Array.isArray(body.slugs) && body.slugs.length) {
    const resolved = await idsFromSlugs(body.slugs.map(String))
    categoryIds.push(...resolved)
  }

  const unique = Array.from(new Set(categoryIds))
  if (!unique.length) {
    return NextResponse.json(
      { error: 'Missing categoryId/categoryIds or slugs' },
      { status: 400 }
    )
  }

  const { added, removed } = await linkCategories(productGid, unique, replaceExisting)

  await rebuildProductCategoryMetafield(productGid)

  return NextResponse.json({
    ok: true,
    productGid,
    categoryIds: unique,
    replaceExisting,
    added,
    removed,
  })
}

// ---------- DELETE (unlink) ----------
export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as DeleteBody

  const rawProduct = body.productGid ?? body.productId ?? ''
  const productGid = normalizeProductGid(String(rawProduct || ''))
  if (!productGid) {
    return NextResponse.json(
      { error: 'Missing productGid/productId' },
      { status: 400 }
    )
  }

  let categoryId: string | null = body.categoryId ?? null
  if (!categoryId && body.slug) {
    const found = await prisma.category.findUnique({
      where: { slug: String(body.slug) },
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
    where: { productGid_categoryId: { productGid, categoryId } },
  })

  await rebuildProductCategoryMetafield(productGid)

  return NextResponse.json({ success: true })
}