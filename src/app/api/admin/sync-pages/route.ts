/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/api/admin/sync-pages/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { shopifyAdminGraphQL, findPageIdByHandle } from '@/lib/shopify'

export const dynamic = 'force-dynamic'

// ✅ Correct Admin GraphQL mutations (note: $page, not $input)
const CREATE_PAGE = /* GraphQL */ `
  mutation CreatePage($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id handle title templateSuffix }
      userErrors { field message code }
    }
  }
`

const UPDATE_PAGE = /* GraphQL */ `
  mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id handle title templateSuffix }
      userErrors { field message code }
    }
  }
`

type DbCategory = {
  id: string
  title: string
  slug: string
  parentId: string | null
}

type FlatCat = { title: string; slug: string }

function authOK(req: NextRequest): boolean {
  const q = req.nextUrl.searchParams.get('secret')
  const h = req.headers.get('x-backfill-secret')
  return Boolean(process.env.BACKFILL_SECRET && (q === process.env.BACKFILL_SECRET || h === process.env.BACKFILL_SECRET))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function flattenCategories(rows: DbCategory[]): FlatCat[] {
  const byParent = new Map<string | null, DbCategory[]>()
  for (const r of rows) {
    const k = r.parentId ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(r)
  }
  const out: FlatCat[] = []
  const walk = (parentId: string | null) => {
    for (const n of byParent.get(parentId) || []) {
      out.push({ title: n.title, slug: n.slug })
      walk(n.id)
    }
  }
  walk(null)
  return out
}

// ---- Preview
export async function GET(req: NextRequest) {
  if (!authOK(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const rows = await prisma.category.findMany({
      select: { id: true, title: true, slug: true, parentId: true },
      orderBy: { title: 'asc' },
    })
    const flat = flattenCategories(rows)
    return NextResponse.json({
      totalCategories: flat.length,
      sample: flat.slice(0, 20),
      hint: 'POST this URL to upsert Shopify pages with template page.category',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load categories' }, { status: 500 })
  }
}

// ---- Upsert all pages
export async function POST(req: NextRequest) {
  if (!authOK(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const createOnly = req.nextUrl.searchParams.get('createOnly') === '1'
  const templateSuffix = 'category' // uses templates/page.category.json

  try {
    const rows = await prisma.category.findMany({
      select: { id: true, title: true, slug: true, parentId: true },
      orderBy: { title: 'asc' },
    })
    const flat = flattenCategories(rows)

    const results: Array<
      | { slug: string; action: 'create'; ok: true; id: string }
      | { slug: string; action: 'create'; ok: false; errors: string }
      | { slug: string; action: 'update'; ok: true; id: string }
      | { slug: string; action: 'update'; ok: false; errors: string }
      | { slug: string; action: 'skip (exists)'; ok: true; id: string }
    > = []

    for (const { slug, title } of flat) {
      try {
        const existingId = await findPageIdByHandle(slug)

        if (existingId) {
          if (createOnly) {
            results.push({ slug, action: 'skip (exists)', ok: true, id: existingId })
          } else {
            // UPDATE with PageUpdateInput
            const data = await shopifyAdminGraphQL<{
              pageUpdate: { page: { id: string } | null; userErrors: { field: string[] | null; message: string; code?: string }[] }
            }>(UPDATE_PAGE, {
              id: existingId,
              page: {
                title,
                templateSuffix,
                body: '', // optional; section template renders the UI
                // isPublished: true, // uncomment if you want to force publish
              },
            })
            const errs = data.pageUpdate.userErrors
            if (errs?.length) {
              results.push({ slug, action: 'update', ok: false, errors: JSON.stringify(errs) })
            } else {
              results.push({ slug, action: 'update', ok: true, id: existingId })
            }
          }
        } else {
          // CREATE with PageCreateInput
          const data = await shopifyAdminGraphQL<{
            pageCreate: { page: { id: string } | null; userErrors: { field: string[] | null; message: string; code?: string }[] }
          }>(CREATE_PAGE, {
            page: {
              title,
              handle: slug,     // becomes /pages/<slug>
              isPublished: true, // publish immediately
              templateSuffix,    // "category"
              body: '',
            },
          })
          const errs = data.pageCreate.userErrors
          if (errs?.length || !data.pageCreate.page) {
            results.push({ slug, action: 'create', ok: false, errors: JSON.stringify(errs || 'No page returned') })
          } else {
            results.push({ slug, action: 'create', ok: true, id: data.pageCreate.page.id })
          }
        }

        await sleep(120) // gentle pacing for Shopify rate limits
      } catch (inner: any) {
        results.push({
          slug,
          action: 'create',
          ok: false,
          errors: inner?.message || String(inner),
        })
        await sleep(120)
      }
    }

    const summary = {
      totalCategories: flat.length,
      created: results.filter((r) => r.action === 'create' && r.ok).length,
      updated: results.filter((r) => r.action === 'update' && r.ok).length,
      skipped: results.filter((r) => r.action === 'skip (exists)').length,
      failures: results.filter((r) => r.ok === false).length,
    }

    return NextResponse.json({ summary, details: results.slice(0, 200) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Sync failed' }, { status: 500 })
  }
}