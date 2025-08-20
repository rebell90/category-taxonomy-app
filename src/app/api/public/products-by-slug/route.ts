// src/app/api/public/products-by-slug/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify';

type ProductLite = {
  id: string;
  handle: string;
  title: string;
  image?: { src: string | null };
  price?: string | null;
  currencyCode?: string | null;
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

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ---- helpers ---------------------------------------------------------------

/**
 * Check if a table exists (case-sensitive name, quoted as created by Prisma).
 */
async function tableExists(schema: string, table: string): Promise<boolean> {
  // format('%I.%I', schema, table) does proper identifier quoting
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass(format('%I.%I', ${schema}, ${table})) IS NOT NULL AS exists
  `;
  return Boolean(rows?.[0]?.exists);
}

/**
 * Get productGids that match YMM from ProductFitment if that table exists.
 * Any of (year, make, model) can be provided; missing ones are ignored.
 */
async function productGidsByYMM(params: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
}): Promise<Set<string> | null> {
  const { year, make, model } = params;
  if (!year && !make && !model) return null; // no YMM filter requested

  const hasTable = await tableExists('ProductFitment');
  if (!hasTable) return null; // silently skip YMM if table not present

  // Build a safe SQL filter
  const clauses: string[] = [];
  const values: Array<number | string> = [];

  if (typeof year === 'number') {
    clauses.push(`(pf."yearStart" IS NULL OR pf."yearStart" <= $${values.length + 1})`);
    values.push(year);
    clauses.push(`(pf."yearEnd" IS NULL OR pf."yearEnd" >= $${values.length + 1})`);
    values.push(year);
  }
  if (make) {
    clauses.push(`(pf."make" ILIKE $${values.length + 1})`);
    values.push(make);
  }
  if (model) {
    clauses.push(`(pf."model" ILIKE $${values.length + 1})`);
    values.push(model);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT DISTINCT pf."productGid"
    FROM "ProductFitment" pf
    ${whereSql}
    LIMIT 5000
  `;

  // Use $queryRawUnsafe to pass the dynamic WHERE… with parameters array
  const rows = (await prisma.$queryRawUnsafe(sql, ...values)) as Array<{ productGid: string }>;
  return new Set(rows.map(r => r.productGid));
}

/**
 * Hydrate products via Admin GraphQL nodes(ids:[]) in batches of up to 50.
 */
async function hydrateProducts(ids: string[]): Promise<ProductLite[]> {
  if (!ids.length) return [];

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

  const batches: ProductLite[] = [];
  const chunkSize = 50;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids: slice });
    const items = (data.nodes || [])
      .filter((n): n is NonNullable<NodesResp['nodes'][number]> => !!n)
      .map(n => {
        const imgSrc = n.images?.edges?.[0]?.node?.src || null;
        const price = n.priceRangeV2?.minVariantPrice?.amount ?? null;
        const currencyCode = n.priceRangeV2?.minVariantPrice?.currencyCode ?? null;
        return {
          id: n.id,
          handle: n.handle,
          title: n.title,
          image: { src: imgSrc },
          price,
          currencyCode,
        };
      });
    batches.push(...items);
  }
  return batches;
}

// ---- main GET --------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug')?.trim();
    const limitParam = Number(url.searchParams.get('limit') || 24);
    const limit = Math.max(1, Math.min(limitParam, 250));

    // YMM (all optional)
    const yearStr = url.searchParams.get('year');
    const make = url.searchParams.get('make')?.trim() || null;
    const model = url.searchParams.get('model')?.trim() || null;
    const year = yearStr ? Number(yearStr) : undefined;
    const validYear = Number.isFinite(year) ? (year as number) : undefined;

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: corsHeaders });
    }

    // 1) Resolve category
    const cat = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!cat) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // 2) All products linked to this exact category
    const catLinks = await prisma.productCategory.findMany({
      where: { categoryId: cat.id },
      select: { productGid: true },
      // don't limit here; we limit after intersect with YMM
    });
    const byCategory = new Set(catLinks.map(l => l.productGid));

    // 3) Intersect with YMM (if requested AND table exists)
    const byYMM = await productGidsByYMM({ year: validYear, make, model });

    let intersected: string[] = [...byCategory];
    if (byYMM) {
      intersected = intersected.filter(gid => byYMM.has(gid));
    }

    if (intersected.length === 0) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // 4) Apply limit and hydrate
    const limited = intersected.slice(0, limit);
    const products = await hydrateProducts(limited);

    // 5) Shape response (flat & light)
    return NextResponse.json(
      {
        products: products.map(p => ({
          id: p.id,
          handle: p.handle,
          title: p.title,
          featuredImage: p.image ? { url: p.image.src } : null,
          price: p.price ?? null,
          currencyCode: p.currencyCode ?? 'USD',
        })),
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    // Don’t leak internals to the browser
    console.error('[public/products-by-slug] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}