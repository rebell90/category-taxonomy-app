/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { shopifyAdminGraphQL, findPageIdByHandle } from '@/lib/shopify'

export const dynamic = 'force-dynamic'

// ----------------- GraphQL mutations -----------------
const CREATE_PAGE = /* GraphQL */ `
  mutation CreatePage($input: PageInput!) {
    pageCreate(page: $input) {
      page { id handle title templateSuffix }
      userErrors { field message }
    }
  }
`

const UPDATE_PAGE = /* GraphQL */ `
  mutation UpdatePage($id: ID!, $input: PageInput!) {
    pageUpdate(id: $id, page: $input) {
      page { id handle title templateSuffix }
      userErrors { field message }
    }
  }
`

// ----------------- Types -----------------
type DbCategory = {
  id: string
  title: string
  slug: string
  parentId: string | null
}

type FlatCat = { title: string; slug: string }

// ----------------- Utils -----------------
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

// ----------------- GET: preview -----------------
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
      hint: 'POST this same URL to create/update Shopify Pages for every category (template: page.category).',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load categories' }, { status: 500 })
  }
}

// ----------------- POST: create/update all pages -----------------
export async function POST(req: NextRequest) {
  if (!authOK(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Optional flags
  const createOnly = req.nextUrl.searchParams.get('createOnly') === '1'
  const templateSuffix = 'category' // use page.category.json template

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
            // Update (title + template)
            const data = await shopifyAdminGraphQL<{
              pageUpdate: { page: { id: string } | null; userErrors: { field: string[] | null; message: string }[] }
            }>(UPDATE_PAGE, {
              id: existingId,
              input: {
                title,
                templateSuffix,
                // Optional: put minimal bodyHtml; template will render anyway
                bodyHtml: '',
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
          // Create
          const data = await shopifyAdminGraphQL<{
            pageCreate: { page: { id: string } | null; userErrors: { field: string[] | null; message: string }[] }
          }>(CREATE_PAGE, {
            input: {
              title,
              handle: slug, // creates /pages/<slug>
              templateSuffix,
              bodyHtml: '',
            },
          })
          const errs = data.pageCreate.userErrors
          if (errs?.length || !data.pageCreate.page) {
            results.push({ slug, action: 'create', ok: false, errors: JSON.stringify(errs || 'No page returned') })
          } else {
            results.push({ slug, action: 'create', ok: true, id: data.pageCreate.page.id })
          }
        }

        // Gentle pacing (Shopify rate limits)
        await sleep(120)
      } catch (inner: any) {
        results.push({
          slug,
          action: (existingActionFor(results, slug) ?? 'create') as any,
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

function existingActionFor(
  results: Array<{ slug: string; action: string; ok: boolean }>,
  slug: string
): 'create' | 'update' | 'skip (exists)' | undefined {
  return [...results].reverse().find((r) => r.slug === slug)?.action as any
}