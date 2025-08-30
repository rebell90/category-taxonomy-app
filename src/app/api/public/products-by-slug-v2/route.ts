// src/app/api/public/products-by-slug-v2/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify';
import type { Prisma } from '@prisma/client';

const corsHeaders: Record<string, string> = {
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
  price?: string | null;
};

type NodesResp = {
  nodes: Array<
    | {
        __typename: 'Product';
        id: string;
        handle: string;
        title: string;
        images: { edges: Array<{ node: { src: string } }> };
        priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } };
      }
    | null
  >;
};

/** Resolve FitTerm IDs -> names for make/model/trim/chassis */
async function resolveFitNames(params: {
  makeId?: string;
  modelId?: string;
  trimId?: string;
  chassisId?: string;
}): Promise<{ make?: string; model?: string; trim?: string; chassis?: string }> {
  const ids = [params.makeId, params.modelId, params.trimId, params.chassisId].filter(
    (v): v is string => Boolean(v)
  );
  if (ids.length === 0) return {};

  const terms = await prisma.fitTerm.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, type: true },
  });

  const out: { make?: string; model?: string; trim?: string; chassis?: string } = {};
  for (const t of terms) {
    if (t.id === params.makeId) out.make = t.name;
    if (t.id === params.modelId) out.model = t.name;
    if (t.id === params.trimId) out.trim = t.name;
    if (t.id === params.chassisId) out.chassis = t.name;
  }
  return out;
}

/** Build WHERE for ProductFitment using names + year range */
function buildFitmentWhere(
  productGids: string[],
  names: { make?: string; model?: string; trim?: string; chassis?: string },
  year?: number
): Prisma.ProductFitmentWhereInput | null {
  const hasAny =
    Boolean(names.make) ||
    Boolean(names.model) ||
    Boolean(names.trim) ||
    Boolean(names.chassis) ||
    typeof year === 'number';

  if (!hasAny) return null;

  const where: Prisma.ProductFitmentWhereInput = { productGid: { in: productGids } };

  if (names.make) where.make = { equals: names.make };
  if (names.model) where.model = { equals: names.model };
  if (names.trim) where.trim = { equals: names.trim };
  if (names.chassis) where.chassis = { equals: names.chassis };

  if (typeof year === 'number') {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
    ];
  }

  return where;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const slug = (url.searchParams.get('slug') || '').trim();
    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: corsHeaders });
    }

    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(Number(limitParam || 24), 250));

    // Optional YMM (IDs from your picker)
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    const makeId = url.searchParams.get('makeId') || undefined;
    const modelId = url.searchParams.get('modelId') || undefined;
    const trimId = url.searchParams.get('trimId') || undefined;
    const chassisId = url.searchParams.get('chassisId') || undefined;

    // 1) Find category
    const cat = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!cat) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // 2) Product GIDs linked to THIS category
    const links = await prisma.productCategory.findMany({
      where: { categoryId: cat.id },
      select: { productGid: true },
      take: limit * 5, // grab extra, YMM filter may cut down
    });
    if (links.length === 0) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    let productGids = links.map((l) => l.productGid);

    // 3) Intersect with fitments (if any YMM provided)
    if (year || makeId || modelId || trimId || chassisId) {
      // translate ids -> names (since ProductFitment stores names)
      const names = await resolveFitNames({ makeId, modelId, trimId, chassisId });
      const fitWhere = buildFitmentWhere(productGids, names, year);
      if (fitWhere) {
        try {
          const fits = await prisma.productFitment.findMany({
            where: fitWhere,
            select: { productGid: true },
            take: limit * 5,
          });
          const allowed = new Set(fits.map((f) => f.productGid));
          productGids = productGids.filter((id) => allowed.has(id));
        } catch {
          // If ProductFitment table/columns are missing, skip YMM filtering
        }
      }
    }

    if (productGids.length === 0) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // Final slice
    productGids = productGids.slice(0, limit);

    // 4) Hydrate via Admin GraphQL nodes(...)
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

    const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids: productGids });

    const products: ProductLite[] = (data.nodes || [])
      .filter((n): n is NonNullable<NodesResp['nodes'][number]> => !!n)
      .map((n) => {
        const imgSrc = n.images?.edges?.[0]?.node?.src || null;
        const price = n.priceRangeV2
          ? `${n.priceRangeV2.minVariantPrice.amount} ${n.priceRangeV2.minVariantPrice.currencyCode}`
          : null;
        return {
          id: n.id,
          handle: n.handle,
          title: n.title,
          image: { src: imgSrc },
          price,
        };
      });

    return NextResponse.json({ products }, { headers: corsHeaders });
  } catch (e) {
    console.error('[products-by-slug-v2] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}