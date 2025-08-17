import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

type Edge = {
  cursor: string
  node: {
    id: string
    title: string
    handle: string
    status?: string | null
  }
}
type PageInfo = { hasNextPage: boolean; endCursor: string | null }
type Resp = { products: { edges: Edge[]; pageInfo: PageInfo } }

export async function GET(req: NextRequest) {
  // Use req to avoid “unused var” warning; e.g., allow ?limit override
  const url = new URL(req.url)
  const limitParam = url.searchParams.get('limit')
  const limit = Math.max(1, Math.min(Number(limitParam || 250), 250)) // cap to 250

  const GQL = `
    query Products($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: TITLE) {
        edges {
          cursor
          node { id title handle status }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  const rows: string[] = []
  rows.push(['id', 'title', 'handle', 'status'].join(','))

  let after: string | null = null
  const first = limit

  // Paginate until done
  for (;;) {
    const data = await shopifyAdminGraphQL<Resp>(GQL, { first, after })
    const { edges, pageInfo } = data.products

    for (const e of edges) {
      const n = e.node
      rows.push(
        [
          `"${n.id}"`,
          `"${(n.title || '').replace(/"/g, '""')}"`,
          `"${(n.handle || '').replace(/"/g, '""')}"`,
          `"${(n.status || '').replace(/"/g, '""')}"`,
        ].join(',')
      )
    }

    if (!pageInfo.hasNextPage) break
    after = pageInfo.endCursor
  }

  const csv = rows.join('\n')
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="product-audit.csv"',
    },
  })
}