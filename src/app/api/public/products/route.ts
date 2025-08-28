import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

type ProductLite = {
  id: string;
  handle: string;
  title: string;
  image?: { src: string | null };
  price?: string | null;
};

type NodesResp = {
  nodes: Array<{
    __typename: 'Product' | string;
    id: string;
    handle: string;
    title: string;
    images?: { edges: Array<{ node: { src: string } }> };
    priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } };
  } | null>
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 24), 250));

    const year = url.searchParams.get('year');
    const makeId = url.searchParams.get('makeId');
    const modelId = url.searchParams.get('modelId');
    const trimId = url.searchParams.get('trimId');
    const chassisId = url.searchParams.get('chassisId');

    // If no YMM, return empty (or you could return latest products if you prefer)
    if (!year && !makeId && !modelId && !trimId && !chassisId) {
      return NextResponse.json({ products: [] }, { headers: cors });
    }

    // Find matching productGids from ProductFitment + FitTerm ids
    // (Year is inclusive within [yearFrom, yearTo] if you store ranges; if yearFrom/yearTo are null, treat as wildcard)
    const yNum = year ? Number(year) : undefined;

    const fitments = await prisma.productFitment.findMany({
      where: {
        ...(yNum ? {
          OR: [
            { AND: [{ yearFrom: { lte: yNum } }, { yearTo: { gte: yNum } }] },
            { AND: [{ yearFrom: null }, { yearTo: null }] },
          ]
        } : {}),
        ...(makeId ? { makeId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(trimId ? { trimId } : {}),
        ...(chassisId ? { chassisId } : {}),
      },
      select: { productGid: true },
      take: limit,
    });

    const ids = Array.from(new Set(fitments.map(f => f.productGid)));
    if (ids.length === 0) return NextResponse.json({ products: [] }, { headers: cors });

    // Hydrate via Admin GraphQL nodes(ids:[])
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
    `;
    const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids });

    const products: ProductLite[] = (data.nodes || [])
      .filter((n): n is NonNullable<NodesResp['nodes'][number]> => !!n && n.__typename === 'Product')
      .map(n => {
        const imgSrc = n.images?.edges?.[0]?.node?.src || null;
        const price = n.priceRangeV2
          ? `${n.priceRangeV2.minVariantPrice.amount} ${n.priceRangeV2.minVariantPrice.currencyCode}`
          : null;
        return { id: n.id, handle: n.handle, title: n.title, image: { src: imgSrc }, price };
      });

    return NextResponse.json({ products }, { headers: cors });
  } catch (e) {
    console.error('[public/products] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: cors });
  }
}