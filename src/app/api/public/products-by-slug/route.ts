// src/app/api/public/products-by-slug/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

// ---- Types for the Admin GraphQL response ----
interface AdminVariantNode {
  id: string
  price: string // Admin returns a string amount
}

interface AdminVariantEdge {
  node: AdminVariantNode
}

interface AdminVariantsConnection {
  edges: AdminVariantEdge[]
}

interface AdminImage {
  url: string
  altText?: string | null
}

interface AdminProductNode {
  id: string
  handle: string
  title: string
  featuredImage?: AdminImage | null
  variants: AdminVariantsConnection
}

interface AdminProductEdge {
  node: AdminProductNode
}

interface ProductsByQueryData {
  products: {
    edges: AdminProductEdge[]
  }
}

// ---- CORS headers for theme fetches ----
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function OPTIONS() {
  return new Response(null, { headers: corsHeaders })
}

/**
 * GET /api/public/products-by-slug?slug=<slug>&limit=12
 * Returns a storefront-friendly list of products that have metafield taxonomy.category_slugs = <slug>
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = (searchParams.get('slug') || '').trim()
    const limitParam = searchParams.get('limit') || '12'
    const limit = Math.min(Number.parseInt(limitParam, 10) || 12, 50)

    if (!slug) {
      return NextResponse.json(
        { error: 'Missing slug' },
        { status: 400, headers: corsHeaders },
      )
    }

    // Try quoted and unquoted admin search variants
    const queries: string[] = [
      `metafield:taxonomy.category_slugs:"${slug.replace(/"/g, '\\"')}"`,
      `metafield:taxonomy.category_slugs=${slug}`,
    ]

    const GQL = /* GraphQL */ `
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

    let edges: AdminProductEdge[] = []

    for (const q of queries) {
      const data = await shopifyAdminGraphQL<ProductsByQueryData>(GQL, {
        q,
        first: limit,
      })
      const current = data?.products?.edges ?? []
      if (current.length > 0) {
        edges = current
        break
      }
    }

    // Normalize to the “storefront-like” shape your theme expects
    const normalized = edges.map((e) => {
      const n = e.node
      const firstVariant = n.variants?.edges?.[0]?.node
      return {
        id: n.id,
        handle: n.handle,
        title: n.title,
        featuredImage: n.featuredImage ?? null,
        price: firstVariant?.price ? Number.parseFloat(firstVariant.price) : null,
        // If you need currency, we can extend the query. For now, default to USD when present.
        currencyCode: 'USD' as const,
      }
    })

    return NextResponse.json({ products: normalized }, { headers: corsHeaders })
  } catch (err: unknown) {
    const message =
      typeof err === 'object' && err && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err)
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders },
    )
  }
}