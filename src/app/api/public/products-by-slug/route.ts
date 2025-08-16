// src/app/api/public/products-by-slug/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { shopifyAdminGraphQL } from '@/lib/shopify'

// -------- Types for the Admin GraphQL response --------
interface AdminVariantNode {
  id: string
  price: string // Admin returns price as a string
}
interface AdminVariantEdge { node: AdminVariantNode }
interface AdminVariantsConnection { edges: AdminVariantEdge[] }

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

interface AdminProductEdge { node: AdminProductNode }

interface ProductsByQueryData {
  products: {
    edges: AdminProductEdge[]
  }
}

// -------- CORS (theme will call this from storefront) --------
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
 * Returns products that have metafield taxonomy.category_slugs EXACTLY equal to <slug>.
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

    // Strict: exact match against the product metafield list
    // (matches if ANY value in the list equals the slug)
    const q = `metafield:taxonomy.category_slugs:"${slug.replace(/"/g, '\\"')}"`

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

    const data = await shopifyAdminGraphQL<ProductsByQueryData>(GQL, {
      q,
      first: limit,
    })

    const edges = data?.products?.edges ?? []

    // Normalize to what your theme expects
    const normalized = edges.map((e) => {
      const n = e.node
      const firstVariant = n.variants?.edges?.[0]?.node
      return {
        id: n.id,
        handle: n.handle,
        title: n.title,
        featuredImage: n.featuredImage ?? null,
        price: firstVariant?.price ? Number.parseFloat(firstVariant.price) : null,
        currencyCode: 'USD' as const, // Extend the query if you need true currency
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