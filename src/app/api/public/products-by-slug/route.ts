// src/app/api/public/products-by-slug/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

// CORS headers for Shopify theme fetch
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { headers: cors })
}

/**
 * GET /api/public/products-by-slug?slug=<slug>&limit=12
 * Returns a storefront-friendly list of products that have metafield taxonomy.category_slugs = <slug>
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = (searchParams.get('slug') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '12', 10) || 12, 50)

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: cors })
    }

    // Admin GraphQL search supports metafield query syntax
    // We’ll try quoted and unquoted forms; use the first that returns results.
    const queries = [
      `metafield:taxonomy.category_slugs:"${slug.replace(/"/g, '\\"')}"`,
      `metafield:taxonomy.category_slugs=${slug}`,
    ]

    // Admin GraphQL (use 2024-07+ in your helper)
    const GQL = `
      query ProductsByQuery($q: String!, $first: Int!) {
        products(first: $first, query: $q) {
          edges {
            node {
              id
              handle
              title
              featuredImage { url altText }
              variants(first: 1) {
                edges { node { id price } }
              }
            }
          }
        }
      }
    `

    let edges: any[] = []
    for (const q of queries) {
      const data = await shopifyAdminGraphQL<{ products: { edges: any[] } }>(GQL, { q, first: limit })
      edges = data?.products?.edges || []
      if (edges.length > 0) break
    }

    // Normalize to a storefront-like shape the theme code already expects
    const normalized = edges.map((e) => {
      const n = e.node
      const priceNode = n.variants?.edges?.[0]?.node
      return {
        id: n.id,
        handle: n.handle,
        title: n.title,
        featuredImage: n.featuredImage || null,
        price: priceNode?.price ? parseFloat(priceNode.price) : null,
        currencyCode: null, // Admin variant.price is amount only; if you need currency, query presentmentPrices or use Storefront later
      }
    })

    return NextResponse.json(
      { products: normalized },
      { headers: cors }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 500, headers: cors }
    )
  }
}