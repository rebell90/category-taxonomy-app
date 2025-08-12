/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { shopifyAdminGraphQL } from '@/lib/shopify'

export const dynamic = 'force-dynamic'

// GraphQL: find pages by handle (via query search)
const FIND_PAGES = `
  query FindPages($q: String!, $first: Int!) {
    pages(first: $first, query: $q) {
      edges {
        node { id handle title templateSuffix }
      }
    }
  }
`

const CREATE_PAGE = `
  mutation CreatePage($input: PageInput!) {
    pageCreate(page: $input) {
      page { id handle title templateSuffix }
      userErrors { field message }
    }
  }
`

const UPDATE_PAGE = `
  mutation UpdatePage($id: ID!, $input: PageInput!) {
    pageUpdate(id: $id, page: $input) {
      page { id handle title templateSuffix }
      userErrors { field message }
    }
  }
`

function flattenTree(nodes: any[]): { title: string; slug: string }[] {
  const out: { title: string; slug: string }[] = []
  const walk = (n: any[]) => {
    for (const node of n) {
      out.push({ title: node.title, slug: node.slug })
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

export async function GET(req: NextRequest) {
  // Preview: list which pages would be created/updated
  const auth = req.headers.get('x-backfill-secret') || req.nextUrl.searchParams.get('secret')
  if (!auth || auth !== process.env.Backfill_SECRET && auth !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await prisma.category.findMany({
    select: { id: true, title: true, slug: true, parentId: true },
  })

  // build simple tree -> then flatten to [{title,slug}]
  const byParent = new Map<string|null, any[]>()
  for (const r of rows) {
    const key = r.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push({ id: r.id, title: r.title, slug: r.slug, children: [] })
  }
  const linkChildren = (parentId: string|null): any[] =>
    (byParent.get(parentId) || []).map(n => ({ ...n, children: linkChildren(n.id) }))

  const tree = linkChildren(null)
  const flat = flattenTree(tree)

  return NextResponse.json({
    categories: flat.length,
    sample: flat.slice(0, 25),
    hint: 'POST this same URL to create/update pages. Pages will be /pages/<slug> and use template "category".'
  })
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-backfill-secret') || req.nextUrl.searchParams.get('secret')
  if (!auth || auth !== process.env.Backfill_SECRET && auth !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // optional: only create (skip updates)
  const createOnly = req.nextUrl.searchParams.get('createOnly') === '1'

  // load full tree to get every slug
  const rows = await prisma.category.findMany({
    select: { id: true, title: true, slug: true, parentId: true },
  })
  const byParent = new Map<string|null, any[]>()
  for (const r of rows) {
    const key = r.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push({ id: r.id, title: r.title, slug: r.slug, children: [] })
  }
  const linkChildren = (parentId: string|null): any[] =>
    (byParent.get(parentId) || []).map(n => ({ ...n, children: linkChildren(n.id) }))
  const flat = flattenTree(linkChildren(null))

  const results: any[] = []

  for (const { title, slug } of flat) {
    // 1) does a page exist with this handle?
    const find = await shopifyAdminGraphQL(FIND_PAGES, {
      q: `handle:${slug}`,
      first: 1,
    })
    const existing = (find as any)?.pages?.edges?.[0]?.node ?? null

    if (!existing) {
      // 2) create it
      const input = {
        title,
        handle: slug,           // results in /pages/<slug>
        published: true,
        templateSuffix: 'category', // uses page.category.json template
        bodyHtml: '',           // optional
        // seo: { title, description: ... } // optional
      }
      const created = await shopifyAdminGraphQL(CREATE_PAGE, { input })
      const errs = (created as any)?.pageCreate?.userErrors
      if (errs?.length) {
        results.push({ slug, action: 'create', ok: false, errors: errs })
      } else {
        const page = (created as any)?.pageCreate?.page
        results.push({ slug, action: 'create', ok: true, id: page?.id })
      }
    } else {
      // 3) update (title/template) unless createOnly mode
      if (createOnly) {
        results.push({ slug, action: 'skip (exists)', ok: true, id: existing.id })
      } else {
        const input = {
          title,
          handle: slug,
          templateSuffix: 'category',
          // bodyHtml: existing.bodyHtml // leave as-is unless you want to overwrite
        }
        const updated = await shopifyAdminGraphQL(UPDATE_PAGE, { id: existing.id, input })
        const errs = (updated as any)?.pageUpdate?.userErrors
        if (errs?.length) {
          results.push({ slug, action: 'update', ok: false, errors: errs })
        } else {
          const page = (updated as any)?.pageUpdate?.page
          results.push({ slug, action: 'update', ok: true, id: page?.id })
        }
      }
    }
  }

  return NextResponse.json({
    totalCategories: flat.length,
    summary: {
      created: results.filter(r => r.action === 'create' && r.ok).length,
      updated: results.filter(r => r.action === 'update' && r.ok).length,
      skipped: results.filter(r => r.action.includes('skip')).length,
      failures: results.filter(r => r.ok === false).length,
    },
    details: results.slice(0, 50) // trim if noisy
  })
}