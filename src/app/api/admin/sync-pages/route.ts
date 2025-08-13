/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { shopifyAdminGraphQL } from '@/lib/shopify'

export const dynamic = 'force-dynamic'

/** ======= GraphQL ======= */
const FIND_PAGES = /* GraphQL */ `
  query FindPages($q: String!, $first: Int!) {
    pages(first: $first, query: $q) {
      edges {
        node { id handle title templateSuffix }
      }
    }
  }
`

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

/** ======= Types ======= */
type DbCategory = {
  id: string
  title: string
  slug: string
  parentId: string | null
}
type FlatCat = { title: string; slug: string }

type FindPagesResp = {
  pages: {
    edges: { node: { id: string; handle: string; title: string; templateSuffix: string | null } }[]
  }
}
type CreatePageResp = {
  pageCreate: {
    page: { id: string; handle: string; title: string; templateSuffix: string | null } | null
    userErrors: { field: string[] | null; message: string }[]
  }
}
type UpdatePageResp = {
  pageUpdate: {
    page: { id: string; handle: string; title: string; templateSuffix: string | null } | null
    userErrors: { field: string[] | null; message: string }[]
  }
}

/** ======= Utils ======= */
function ensureSecret(req: NextRequest): boolean {
  const header = req.headers.get('x-backfill-secret')
  const query = req.nextUrl.searchParams.get('secret')
  const secret = process.env.BACKFILL_SECRET
  return Boolean(secret && (header === secret || query === secret))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function findPageByHandle(handle: string) {
  const data = await shopifyAdminGraphQL<FindPagesResp>(FIND_PAGES, { q: `handle:${handle}`, first: 1 })
  return data.pages.edges[0]?.node ?? null
}

async function createPage(input: {
  title: string
  handle: string
  published?: boolean
  templateSuffix?: string | null
  bodyHtml?: string
}) {
  const data = await shopifyAdminGraphQL<CreatePageResp>(CREATE_PAGE, { input })
  const errs = data.pageCreate.userErrors
  if (errs?.length) throw new Error('pageCreate ' + JSON.stringify(errs))
  return data.pageCreate.page
}

async function updatePage(id: string, input: Partial<{ title: string; handle: string; templateSuffix: string | null; bodyHtml: string }>) {
  const data = await shopifyAdminGraphQL<UpdatePageResp>(UPDATE_PAGE, { id, input })
  const errs = data.pageUpdate.userErrors
  if (errs?.length) throw new Error('pageUpdate ' + JSON.stringify(errs))
  return data.pageUpdate.page
}

function flattenTree(rows: DbCategory[]): FlatCat[] {
  // Build adjacency
  const byParent = new Map<string | null, DbCategory[]>()
  for (const r of rows) {
    const key = r.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(r)
  }
  // Recursive walk
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

/** ======= GET: preview what will be created/updated ======= */
export async function GET(req: NextRequest) {
  if (!ensureSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const rows = await prisma.category.findMany({
      select: { id: true, title: true, slug: true, parentId: true },
      orderBy: { title: 'asc' },
    })
    const flat = flattenTree(rows)
    return NextResponse.json({
      categories: flat.length,
      sample: flat.slice(0, 25),
      hint: 'POST this same URL to create/update pages. Pages will be /pages/<slug> using template "category".',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load categories' }, { status: 500 })
  }
}

/** ======= POST: create/update pages for all categories ======= */
export async function POST(req: NextRequest) {
  if (!ensureSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const createOnly = req.nextUrl.searchParams.get('createOnly') === '1'
  const templateSuffix = 'category' // change if your template is named differently

  try {
    const rows = await prisma.category.findMany({
      select: { id: true, title: true, slug: true, parentId: true },
      orderBy: { title: 'asc' },
    })
    const flat = flattenTree(rows)

    const results: Array<
      | { slug: string; action: 'create'; ok: true; id: string }
      | { slug: string; action: 'create'; ok: false; errors: string }
      | { slug: string; action: 'update'; ok: true; id: string }
      | { slug: string; action: 'update'; ok: false; errors: string }
      | { slug: string; action: 'skip (exists)'; ok: true; id: string }
    > = []

    for (const { title, slug } of flat) {
      try {
        const existing = await findPageByHandle(slug)

        if (!existing) {
          const created = await createPage({
            title,
            handle: slug, // results in /pages/<slug>
            published: true,
            templateSuffix,
            bodyHtml: '', // optional
          })
          results.push({ slug, action: 'create', ok: true, id: created!.id })
        } else if (createOnly) {
          results.push({ slug, action: 'skip (exists)', ok: true, id: existing.id })
        } else {
          const updated = await updatePage(existing.id, {
            title,
            handle: slug,
            templateSuffix,
          })
          results.push({ slug, action: 'update', ok: true, id: updated!.id })
        }

        // Gentle pacing to avoid throttling (adjust if needed)
        await sleep(150)
      } catch (inner: any) {
        results.push({
          slug,
          action: existingActionFor(results, slug) ?? ('create' as any),
          ok: false,
          errors: inner?.message || String(inner),
        })
        await sleep(150)
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

/** Helper: best effort to label failure action */
function existingActionFor(
  results: Array<{ slug: string; action: string; ok: boolean }>
, slug: string): 'create' | 'update' | 'skip (exists)' | undefined {
  const last = [...results].reverse().find((r) => r.slug === slug)
  return (last?.action as any) || undefined
}