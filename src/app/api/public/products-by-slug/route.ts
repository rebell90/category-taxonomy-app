import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { shopifyAdminGraphQL } from '@/lib/shopify'

type ProductLite = {
  id: string
  handle: string
  title: string
  image?: { src: string | null }
  price?: string | null
}

type NodesResp = {
  nodes: Array<{
    __typename: 'Product'
    id: string
    handle: string
    title: string
    images: { edges: Array<{ node: { src: string } }> }
    priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } }
  } | null>
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')?.trim()
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 24), 250))

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  }

  // 1) Find category
  const cat = await prisma.category.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!cat) {
    return NextResponse.json({ products: [] }, { status: 200 })
  }

  // 2) Get linked product GIDs for this exact category
  const links = await prisma.productCategory.findMany({
    where: { categoryId: cat.id },
    select: { productGid: true },
    take: limit,
  })
  if (links.length === 0) {
    return NextResponse.json({ products: [] }, { status: 200 })
  }

  // 3) Query Admin GraphQL nodes(ids:[]) to hydrate storefront info
  const ids = links.map(l => l.productGid)

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
      const imgSrc = n.images?.edges?.[0]?.node?.src || null
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

  return NextResponse.json({ products })
}