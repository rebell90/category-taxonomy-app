/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

export const dynamic = 'force-dynamic'

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

const QUERY = `
  query ProductsSearch($first: Int!, $after: String, $q: String, $sortKey: ProductSortKeys!, $reverse: Boolean!) {
    products(first: $first, after: $after, query: $q, sortKey: $sortKey, reverse: $reverse) {
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
    const sortBy = searchParams.get('sortBy')
    
    const { sortKey, reverse } = parseSortParams(sortBy)

    const data = await shopifyAdminGraphQL(QUERY, { 
      first, 
      after, 
      q: q || null,
      sortKey,
      reverse
    })
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