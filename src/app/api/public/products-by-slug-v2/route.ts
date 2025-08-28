import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

type ProductLite = {
  id: string;
  handle: string;
  title: string;
  image?: { src: string | null };
  price?: string | null; // "129.00 USD"
};

type NodesResp = {
  nodes: Array<
    | {
        __typename: 'Product';
        id: string;
        handle: string;
        title: string;
        images?: { edges: Array<{ node: { src: string } }> };
        priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } };
      }
    | null
  >;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const slug = (url.searchParams.get('slug') || '').trim();
    const limitParam = Number(url.searchParams.get('limit') || '24');
    const limit = Math.max(1, Math.min(limitParam, 250));

    const year = url.searchParams.get('year');
    const makeId = url.searchParams.get('makeId') || undefined;
    const modelId = url.searchParams.get('modelId') || undefined;
    const trimId = url.searchParams.get('trimId') || undefined;
    const chassisId = url.searchParams.get('chassisId') || undefined;

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: corsHeaders });
    }

    // 1) Resolve category
    const category = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // 2) products linked to this category
    const catLinks = await prisma.productCategory.findMany({
      where: { categoryId: category.id },
      select: { productGid: true },
      take: limit * 3,
    });
    if (catLinks.length === 0) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    let productGids = catLinks.map(l => l.productGid);

    // 3) Apply YMM intersection if any filter provided
    const hasAnyYmm = Boolean(makeId || modelId || trimId || chassisId || (year !== null && year !== ''));
    if (hasAnyYmm) {
      const y = year ? Number(year) : undefined;

      const where: Parameters<typeof prisma.productFitment.findMany>[0]['where'] = {
        productGid: { in: productGids },
      };
      if (makeId)    where.makeId = { equals: makeId };
      if (modelId)   where.modelId = { equals: modelId };
      if (trimId)    where.trimId = { equals: trimId };
      if (chassisId) where.chassisId = { equals: chassisId };

      if (y !== undefined && !Number.isNaN(y)) {
        where.AND = [
          { OR: [{ yearFrom: null }, { yearFrom: { lte: y } }] },
          { OR: [{ yearTo: null }, { yearTo: { gte: y } }] },
        ];
      }

      const fitLinks = await prisma.productFitment.findMany({
        where,
        select: { productGid: true },
        take: limit * 5,
      });

      if (fitLinks.length === 0) {
        return NextResponse.json({ products: [] }, { headers: corsHeaders });
      }

      const fitSet = new Set(fitLinks.map(f => f.productGid));
      productGids = productGids.filter(gid => fitSet.has(gid));
      if (productGids.length === 0) {
        return NextResponse.json({ products: [] }, { headers: corsHeaders });
      }
    }

    // 4) Hydrate via Admin GraphQL nodes(ids:[])
    const ids = productGids.slice(0, limit);
    const chunks = chunk(ids, 50);

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

    const products: ProductLite[] = [];
    for (const idsChunk of chunks) {
      const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids: idsChunk });
      (data.nodes || []).forEach(n => {
        if (!n || n.__typename !== 'Product') return;
        const imgSrc = n.images?.edges?.[0]?.node?.src || null;
        const price = n.priceRangeV2
          ? `${n.priceRangeV2.minVariantPrice.amount} ${n.priceRangeV2.minVariantPrice.currencyCode}`
          : null;

        products.push({
          id: n.id,
          handle: n.handle,
          title: n.title,
          image: { src: imgSrc },
          price,
        });
      });
    }

    return NextResponse.json({ products }, { headers: corsHeaders });
  } catch (e) {
    console.error('[public/products-by-slug-v2] error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}