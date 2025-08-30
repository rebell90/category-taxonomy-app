// src/app/api/public/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
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

type CategoryRow = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
};

type CategoryNode = CategoryRow & {
  children?: CategoryNode[];
  // Optional counts your theme can use (not required)
  _selfCount?: number;
  _totalCount?: number;
};

/** Hard-coded, safe check that the ProductFitment table exists (quoted name). */
async function productFitmentTableExists(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT (to_regclass('public."ProductFitment"') IS NOT NULL) AS exists
    `;
    return Boolean(rows?.[0]?.exists);
  } catch {
    return false;
  }
}

/** Build a nested tree from flat rows (no filtering yet). */
function buildTree(rows: CategoryRow[], parentId: string | null): CategoryNode[] {
  return rows
    .filter(r => r.parentId === parentId)
    .map(r => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

/** Apply YMM → create a Prisma where for ProductFitment (or null = no YMM) */
// keep signature the same
function buildFitmentWhere(
  productGids: string[],
  params: {
    year?: number;
    makeId?: string;   // we’ll map these to string columns below
    modelId?: string;
    trimId?: string;
    chassisId?: string;
  }
): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;

  // If no fitment provided, skip filtering
  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = {
    productGid: { in: productGids },
  };

  // Your schema uses string columns: make/model/trim/chassis
  if (makeId)   where.make   = { equals: makeId };
  if (modelId)  where.model  = { equals: modelId };
  if (trimId)   where.trim   = { equals: trimId };
  if (chassisId) where.chassis = { equals: chassisId };

  if (typeof year === 'number') {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
    ];
  }

  return where;
}

/** Recursively compute total counts and filter out empty branches. */
function filterTreeByCounts(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];

  for (const n of nodes) {
    const children = n.children ? filterTreeByCounts(n.children) : [];
    const selfCount = n._selfCount ?? 0;
    const childrenTotal = children.reduce((sum, c) => sum + (c._totalCount ?? 0), 0);
    const total = selfCount + childrenTotal;

    if (total > 0) {
      out.push({
        ...n,
        children,
        _totalCount: total,
      });
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // Optional YMM params (IDs are string; year is number)
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    const makeId = url.searchParams.get('makeId') || undefined;
    const modelId = url.searchParams.get('modelId') || undefined;
    const trimId = url.searchParams.get('trimId') || undefined;
    const chassisId = url.searchParams.get('chassisId') || undefined;

    // 1) Load all categories (flat)
    const rows = await prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        parentId: true,
      },
    });

    // 2) Build a quick map of categoryId → productGids
    const allCategoryIds = rows.map(r => r.id);
    const catLinks = await prisma.productCategory.findMany({
      where: { categoryId: { in: allCategoryIds } },
      select: { productGid: true, categoryId: true },
    });

    const productGidsByCat = new Map<string, string[]>();
    for (const link of catLinks) {
      const list = productGidsByCat.get(link.categoryId) || [];
      list.push(link.productGid);
      productGidsByCat.set(link.categoryId, list);
    }

    // 3) If YMM supplied AND ProductFitment exists, intersect with matching productGids
    let allowedSet: Set<string> | null = null;
    const hasYmm =
      Boolean(year) || Boolean(makeId) || Boolean(modelId) || Boolean(trimId) || Boolean(chassisId);

    if (hasYmm && (await productFitmentTableExists())) {
      const allGids = Array.from(new Set(catLinks.map(l => l.productGid)));
      if (allGids.length) {
        const where = buildFitmentWhere(allGids, { year, makeId, modelId, trimId, chassisId });
        if (where) {
          const fits = await prisma.productFitment.findMany({
            where,
            select: { productGid: true },
          });
          allowedSet = new Set(fits.map(f => f.productGid));
        }
      }
    }

    // 4) Compute counts per category (self only) and build tree
    const withCounts: CategoryNode[] = rows.map(r => {
      const allForCat = productGidsByCat.get(r.id) || [];
      const selfCount =
        allowedSet === null
          ? allForCat.length
          : allForCat.reduce((acc, gid) => acc + (allowedSet!.has(gid) ? 1 : 0), 0);
      return { ...r, _selfCount: selfCount };
    });

    const tree = buildTree(withCounts, null);

    // 5) If YMM active, drop branches with zero total products; else return full tree
    const finalTree = hasYmm ? filterTreeByCounts(tree) : tree;

    return NextResponse.json({ tree: finalTree }, { headers: corsHeaders });
  } catch (e) {
    console.error('[public/categories] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}