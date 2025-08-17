import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { shopifyAdminGraphQL } from '@/lib/shopify'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
} as const

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

type ProductLite = {
  id: string
  handle: string
  title: string
  image?: { src: string | null }
  price?: string | null
}

type NodesResp = {
  nodes: Array<
    | {
        __typename: 'Product'
        id: string
        handle: string
        title: string
        images: { edges: Array<{ node: { src: string } }> }
        priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } }
      }
    | null
  >
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const slug = url.searchParams.get('slug')?.trim()
    const limitRaw = Number(url.searchParams.get('limit') || 24)
    const limit = Math.max(1, Math.min(isFinite(limitRaw) ? limitRaw : 24, 250))

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: corsHeaders })
    }

    // 1) Find category by slug
    const cat = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    })
    if (!cat) {
      return NextResponse.json({ products: [] }, { status: 200, headers: corsHeaders })
    }

    // 2) Linked products for this exact category
    const links = await prisma.productCategory.findMany({
      where: { categoryId: cat.id },
      select: { productGid: true },
      take: limit, // cap here; 'nodes' can take a lot but keep it sane
    })
    if (links.length === 0) {
      return NextResponse.json({ products: [] }, { status: 200, headers: corsHeaders })
    }

    const ids = links.map(l => l.productGid)

    // 3) Hydrate minimal product info via Admin GraphQL
    const GQL = `
      query Nodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            handle
            title
            images(first: 1) { edges { node { src: url } } }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
          }
        }
      }
    `
    const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids })

    const products: ProductLite[] = (data.nodes || [])
      .filter((n): n is NonNullable<NodesResp['nodes'][number]> => !!n)
      .map(n => {
        const imgSrc = n.images?.edges?.[0]?.node?.src ?? null
        const price = n.priceRangeV2
          ? `${n.priceRangeV2.minVariantPrice.amount} ${n.priceRangeV2.minVariantPrice.currencyCode}`
          : null
        return {
          id: n.id,
          handle: n.handle,
          title: n.title,
          image: { src: imgSrc },
          price,
        }
      })

    return NextResponse.json({ products }, { headers: corsHeaders })
  } catch (err) {
    // Surface a safe error but keep CORS so the theme can read it
    return NextResponse.json(
      { error: 'Failed to load products' },
      { status: 500, headers: corsHeaders },
    )
  }
}