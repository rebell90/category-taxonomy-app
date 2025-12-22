// src/app/api/admin/products-audit/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

type PageInfo = { hasNextPage: boolean; endCursor: string | null }

interface ProductNode {
  id: string
  title: string
  handle: string
  status?: string | null
  metafield?: { value?: string | null } | null
}

interface ProductEdge { node: ProductNode }
interface ProductsConnection { edges: ProductEdge[]; pageInfo: PageInfo }

interface ProductsResp {
  products: ProductsConnection
}

const cors: Record<string,string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function OPTIONS() {
  return new Response(null, { headers: cors })
}

// Helper to parse sortBy parameter
function parseSortParams(sortBy?: string | null): { sortKey: string; reverse: boolean } {
  switch (sortBy) {
    case 'UPDATED_AT_DESC':
      return { sortKey: 'UPDATED_AT', reverse: true }
    case 'UPDATED_AT_ASC':
      return { sortKey: 'UPDATED_AT', reverse: false }
    case 'TITLE_ASC':
      return { sortKey: 'TITLE', reverse: false }
    case 'TITLE_DESC':
      return { sortKey: 'TITLE', reverse: true }
    default:
      // Default: Last edited (newest first)
      return { sortKey: 'UPDATED_AT', reverse: true }
  }
}

// GET /api/admin/products-audit?cursor=<cursor>&limit=50&sortBy=<sortBy>
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const after = searchParams.get('cursor')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 250)
    const sortBy = searchParams.get('sortBy')
    
    const { sortKey, reverse } = parseSortParams(sortBy)

    const GQL = /* GraphQL */ `
      query ProductsAudit($first: Int!, $after: String, $sortKey: ProductSortKeys!, $reverse: Boolean!) {
        products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
          edges {
            node {
              id
              title
              handle
              status
              metafield(namespace: "taxonomy", key: "category_slugs") {
                value
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `

    const data = await shopifyAdminGraphQL<ProductsResp>(GQL, { 
      first: limit, 
      after,
      sortKey,
      reverse
    })
    
    const conn = data.products
    const items = conn.edges.map(e => {
      const n = e.node
      // metafield.value is JSON string when the metafield is list-of-text; could also be plain string
      let slugs: string[] = []
      const raw = n.metafield?.value ?? null
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) slugs = parsed.filter(x => typeof x === 'string')
          else if (typeof parsed === 'string') slugs = [parsed]
        } catch {
          // not JSON; treat as single value
          slugs = [raw]
        }
      }
      return {
        id: n.id,
        title: n.title,
        handle: n.handle,
        status: n.status ?? null,
        slugs,
      }
    })

    return NextResponse.json(
      { items, pageInfo: conn.pageInfo },
      { headers: cors }
    )
  } catch (err: unknown) {
    const message = typeof err === 'object' && err && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)
    return NextResponse.json({ error: message }, { status: 500, headers: cors })
  }
}