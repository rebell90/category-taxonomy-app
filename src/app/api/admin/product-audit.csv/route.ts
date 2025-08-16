// src/app/api/admin/products-audit.csv/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

interface PageInfo { hasNextPage: boolean; endCursor: string | null }
interface ProductNode {
  id: string
  title: string
  handle: string
  metafield?: { value?: string | null } | null
}
interface Edge { node: ProductNode }
interface Resp {
  products: { edges: Edge[]; pageInfo: PageInfo }
}

export async function GET(_req: NextRequest) {
  const chunks: string[] = ['"id","title","handle","slugs"\n']
  let after: string | null = null
  const first = 200

  const GQL = /* GraphQL */ `
    query ProductsAuditCSV($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: TITLE) {
        edges {
          node {
            id
            title
            handle
            metafield(namespace:"taxonomy", key:"category_slugs") { value }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  // Loop all pages
  /* eslint-disable no-constant-condition */
  while (true) {
    const data: Resp = await shopifyAdminGraphQL<Resp>(GQL, { first, after })
    const { edges, pageInfo } = data.products

    for (const e of edges) {
      const n = e.node
      // Normalize metafield value (may be JSON array string or a plain string)
      let slugs: string[] = []
      const raw = n.metafield?.value ?? null
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) slugs = parsed.filter((x: unknown) => typeof x === 'string')
          else if (typeof parsed === 'string') slugs = [parsed]
        } catch {
          slugs = [raw]
        }
      }

      const row = [
        n.id.replace(/"/g, '""'),
        n.title.replace(/"/g, '""'),
        n.handle.replace(/"/g, '""'),
        slugs.join('|').replace(/"/g, '""'),
      ]
        .map((v) => `"${v}"`)
        .join(',')

      chunks.push(row + '\n')
    }

    if (!pageInfo.hasNextPage) break
    after = pageInfo.endCursor
  }

  return new NextResponse(chunks.join(''), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="products_audit.csv"',
      'Cache-Control': 'no-store',
    },
  })
}