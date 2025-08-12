import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

export const dynamic = 'force-dynamic'

const QUERY = `
  query ProductsSearch($first: Int!, $after: String, $q: String) {
    products(first: $first, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          featuredImage { url altText }
          status
        }
      }
    }
  }
`

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const q = searchParams.get('q') || ''     // e.g. "title:exhaust OR sku:123"
    const after = searchParams.get('after')
    const first = Math.min(parseInt(searchParams.get('first') || '20', 10), 50)

    const data = await shopifyAdminGraphQL(QUERY, { first, after, q: q || null })
    const { products } = (data as any)

    const items = products.edges.map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      image: e.node.featuredImage?.url || null,
      status: e.node.status,
    }))

    return NextResponse.json({
      items,
      nextCursor: products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Search failed' }, { status: 500 })
  }
}