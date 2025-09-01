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
        images: { edges: Array<{ node: { url?: string; src?: string } }> };
        priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } };
      }
    | null
  >;
};

// Safe table existence on Postgres
async function tableExists(tableName: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      ) AS "exists";
    `;
    return Boolean(rows?.[0]?.exists);
  } catch {
    return false;
  }
}

// Build WHERE for ProductFitment using string fields (make/model/trim/chassis) and open year ranges
function buildFitmentWhere(
  productGids: string[],
  params: { year?: number; make?: string; model?: string; trim?: string; chassis?: string }
): Prisma.ProductFitmentWhereInput | null {
  const { year, make, model, trim, chassis } = params;

  if (!year && !make && !model && !trim && !chassis) return null;

  const where: Prisma.ProductFitmentWhereInput = {
    productGid: { in: productGids },
  };

  // Case-insensitive exact matches on strings
  if (make)   where.make   = { equals: make.trim(), mode: 'insensitive' };
  if (model)  where.model  = { equals: model.trim(), mode: 'insensitive' };
  if (trim)   where.trim   = { equals: trim.trim(),  mode: 'insensitive' };
  if (chassis)where.chassis= { equals: chassis.trim(), mode: 'insensitive' };

  if (typeof year === 'number') {
    const y = year;
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: y } }] },
      { OR: [{ yearTo: null },   { yearTo:   { gte: y } }] },
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

    // YMM as STRINGS (important: make/model are strings here)
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    const make = url.searchParams.get('make') || undefined;
    const model = url.searchParams.get('model') || undefined;
    const trim = url.searchParams.get('trim') || undefined;
    const chassis = url.searchParams.get('chassis') || undefined;

    // 1) Find category
    const cat = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!cat) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // 2) Product links for this category
    const links = await prisma.productCategory.findMany({
      where: { categoryId: cat.id },
      select: { productGid: true },
      take: limit * 5, // grab extra; fitment filter may shrink results
    });
    if (links.length === 0) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    let productGids = links.map(l => l.productGid);

    // 3) Fitment intersection (only if any YMM provided AND table exists)
    if (await tableExists('ProductFitment')) {
      const fitWhere = buildFitmentWhere(productGids, { year, make, model, trim, chassis });
      if (fitWhere) {
        const fits = await prisma.productFitment.findMany({
          where: fitWhere,
          select: { productGid: true },
          take: limit * 10,
        });

        const allowed = new Set(fits.map(f => f.productGid));
        productGids = productGids.filter(id => allowed.has(id));
      }
    }

    if (productGids.length === 0) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // Final slice for hydration
    productGids = productGids.slice(0, limit);

    // 4) Hydrate products via Admin GraphQL
    const GQL = `
      query Nodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            handle
            title
            images(first: 1) { edges { node { url } } }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
          }
        }
      }
    `;

    const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids: productGids });

    const products: ProductLite[] =
      (data.nodes || [])
        .filter((n): n is NonNullable<NodesResp['nodes'][number]> => !!n)
        .map(n => {
          const img = n.images?.edges?.[0]?.node?.url ?? null;
          const price = n.priceRangeV2
            ? `${n.priceRangeV2.minVariantPrice.amount} ${n.priceRangeV2.minVariantPrice.currencyCode}`
            : null;
          return {
            id: n.id,
            handle: n.handle,
            title: n.title,
            image: { src: img },
            price,
          };
        });

    // Uncomment for quick debugging (then re-comment):
    // console.log('[v2] params', { slug, year, make, model, trim, chassis, limit });
    // console.log('[v2] productGids after filter', productGids.length);

    return NextResponse.json({ products }, { headers: corsHeaders });
  } catch (e) {
    console.error('[products-by-slug-v2] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}