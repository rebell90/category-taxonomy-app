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

// Resolve FitTerm IDs to their human-readable names (for OR matching against old name rows).
async function resolveTermNames(ids: (string | undefined)[]): Promise<Map<string, string>> {
  const validIds = ids.filter((id): id is string => !!id);
  if (!validIds.length) return new Map();
  const terms = await prisma.fitTerm.findMany({
    where: { id: { in: validIds } },
    select: { id: true, name: true },
  });
  return new Map(terms.map(t => [t.id, t.name]));
}

/**
 * Build a Prisma WHERE that matches fitment by ID OR by name, so it works for
 * both new rows (store FitTerm IDs) and old rows (store human-readable names).
 *
 * chassis=null on a fitment row means "fits all chassis" and always matches
 * when any chassis filter is active.
 */
function buildFitmentWhere(
  productGids: string[],
  p: {
    year?: number;
    makeId?: string;   makeName?: string;   resolvedMakeName?: string;
    modelId?: string;  modelName?: string;  resolvedModelName?: string;
    trimId?: string;   trimName?: string;   resolvedTrimName?: string;
    chassisId?: string; chassisName?: string; resolvedChassisName?: string;
  }
): Prisma.ProductFitmentWhereInput | null {
  const hasMake    = p.makeId    || p.makeName;
  const hasModel   = p.modelId   || p.modelName;
  const hasTrim    = p.trimId    || p.trimName;
  const hasChassis = p.chassisId || p.chassisName;

  if (!p.year && !hasMake && !hasModel && !hasTrim && !hasChassis) return null;

  const and: Prisma.ProductFitmentWhereInput[] = [
    { productGid: { in: productGids } },
  ];

  function fieldOr(
    field: 'make' | 'model' | 'trim' | 'chassis',
    id?: string,
    resolved?: string,
    name?: string,
  ): Prisma.ProductFitmentWhereInput {
    const clauses: Prisma.ProductFitmentWhereInput[] = [];
    if (id)       clauses.push({ [field]: { equals: id } });
    if (resolved) clauses.push({ [field]: { equals: resolved, mode: 'insensitive' } });
    if (name)     clauses.push({ [field]: { equals: name.trim(), mode: 'insensitive' } });
    return { OR: clauses };
  }

  if (hasMake)    and.push(fieldOr('make',    p.makeId,    p.resolvedMakeName,    p.makeName));
  if (hasModel)   and.push(fieldOr('model',   p.modelId,   p.resolvedModelName,   p.modelName));
  if (hasTrim)    and.push(fieldOr('trim',    p.trimId,    p.resolvedTrimName,    p.trimName));
  if (hasChassis) {
    // chassis=null means "fits all chassis" — always match those rows
    const chassisOr = fieldOr('chassis', p.chassisId, p.resolvedChassisName, p.chassisName);
    and.push({ OR: [{ chassis: null }, ...(chassisOr.OR ?? [])] });
  }

  if (typeof p.year === 'number') {
    const y = p.year;
    and.push({ OR: [{ yearFrom: null }, { yearFrom: { lte: y } }] });
    and.push({ OR: [{ yearTo:   null }, { yearTo:   { gte: y } }] });
  }

  return { AND: and };
}

async function getDescendantIds(catId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE descendants AS (
      SELECT id FROM "Category" WHERE id = ${catId} AND "archivedAt" IS NULL
      UNION ALL
      SELECT c.id FROM "Category" c
      JOIN descendants d ON c."parentId" = d.id
      WHERE c."archivedAt" IS NULL
    )
    SELECT id FROM descendants;
  `;
  return rows.map(r => r.id);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const slug = (url.searchParams.get('slug') || '').trim();
    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: corsHeaders });
    }

    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(Number(limitParam || 24), 500));

    const offsetParam = url.searchParams.get('offset');
    const offset = Math.max(0, Number(offsetParam || 0));

    const year = url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined;

    // Primary: ID params sent by the storefront picker (FitTerm IDs)
    const makeId    = url.searchParams.get('make_id')    || undefined;
    const modelId   = url.searchParams.get('model_id')   || undefined;
    const trimId    = url.searchParams.get('trim_id')    || undefined;
    const chassisId = url.searchParams.get('chassis_id') || undefined;

    // Fallback: name params (old theme code or direct calls)
    const makeName    = url.searchParams.get('make')    || undefined;
    const modelName   = url.searchParams.get('model')   || undefined;
    const trimName    = url.searchParams.get('trim')    || undefined;
    const chassisName = url.searchParams.get('chassis') || undefined;

    const usingIds   = !!(makeId || modelId || chassisId);
    const usingNames = !!(makeName || modelName || chassisName);
    if (usingNames && !usingIds) {
      console.warn('[products-by-slug-v2] name-based vehicle filter (no IDs) — slug:', slug, { makeName, modelName, chassisName });
    }

    // 1) Find category
    const cat = await prisma.category.findFirst({
      where: { slug, archivedAt: null },
      select: { id: true },
    });
    if (!cat) {
      return NextResponse.json({ products: [] }, { headers: corsHeaders });
    }

    // 2) Gather all descendant category IDs (handles parent categories with no direct products)
    const categoryIds = await getDescendantIds(cat.id);

    // 3) Product links for this category and all descendants
    const links = await prisma.productCategory.findMany({
      where: { categoryId: { in: categoryIds } },
      select: { productGid: true },
    });
    if (links.length === 0) {
      return NextResponse.json({ products: [], total: 0 }, { headers: corsHeaders });
    }

    // Deduplicate: a product assigned to multiple descendant categories appears once per assignment
    let productGids = [...new Set(links.map(l => l.productGid))];

    // 4) Fitment intersection
    if (await tableExists('ProductFitment')) {
      // Resolve IDs → names so we can OR-match against old name-based rows
      const termNames = await resolveTermNames([makeId, modelId, trimId, chassisId]);

      const fitWhere = buildFitmentWhere(productGids, {
        year,
        makeId,    makeName,    resolvedMakeName:    makeId    ? termNames.get(makeId)    : undefined,
        modelId,   modelName,   resolvedModelName:   modelId   ? termNames.get(modelId)   : undefined,
        trimId,    trimName,    resolvedTrimName:    trimId    ? termNames.get(trimId)    : undefined,
        chassisId, chassisName, resolvedChassisName: chassisId ? termNames.get(chassisId) : undefined,
      });

      if (fitWhere) {
        const fits = await prisma.productFitment.findMany({
          where: fitWhere,
          select: { productGid: true },
        });
        const allowed = new Set(fits.map(f => f.productGid));
        productGids = productGids.filter(id => allowed.has(id));
      }
    }

    if (productGids.length === 0) {
      return NextResponse.json({ products: [], total: 0 }, { headers: corsHeaders });
    }

    const total = productGids.length;
    productGids = productGids.slice(offset, offset + limit);

    // 5) Hydrate via Admin GraphQL
    const GQL = `
      query Nodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id handle title
            images(first: 1) { edges { node { url } } }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
          }
        }
      }
    `;

    const data = await shopifyAdminGraphQL<NodesResp>(GQL, { ids: productGids });

    const products: ProductLite[] = (data.nodes || [])
      .filter((n): n is NonNullable<NodesResp['nodes'][number]> => !!n)
      .map(n => {
        const img = n.images?.edges?.[0]?.node?.url ?? null;
        const price = n.priceRangeV2
          ? `${n.priceRangeV2.minVariantPrice.amount} ${n.priceRangeV2.minVariantPrice.currencyCode}`
          : null;
        return { id: n.id, handle: n.handle, title: n.title, image: { src: img }, price };
      });

    return NextResponse.json({ products, total }, { headers: corsHeaders });
  } catch (e) {
    console.error('[products-by-slug-v2] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}
