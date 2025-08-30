// src/app/api/public/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

type CatRow = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  // optional columns; may not exist in DB
  image?: string | null;
  description?: string | null;
};

type CatNode = CatRow & {
  productCount: number;
  children?: CatNode[];
};

// Build a tree from flat rows
function buildTree(rows: CatNode[], parentId: string | null): CatNode[] {
  return rows
    .filter(r => r.parentId === parentId)
    .map(r => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

// YMM → Prisma where for ProductFitment (string columns)
function buildFitmentWhere(params: {
  year?: number;
  makeId?: string;
  modelId?: string;
  trimId?: string;
  chassisId?: string;
}): Prisma.ProductFitmentWhereInput | null {
  const { year, makeId, modelId, trimId, chassisId } = params;

  if (!year && !makeId && !modelId && !trimId && !chassisId) return null;

  const where: Prisma.ProductFitmentWhereInput = {};

  if (makeId)   where.make    = { equals: makeId };
  if (modelId)  where.model   = { equals: modelId };
  if (trimId)   where.trim    = { equals: trimId };
  if (chassisId) where.chassis = { equals: chassisId };

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

    // Optional YMM params
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    const makeId = url.searchParams.get('makeId') || undefined;
    const modelId = url.searchParams.get('modelId') || undefined;
    const trimId = url.searchParams.get('trimId') || undefined;
    const chassisId = url.searchParams.get('chassisId') || undefined;

    // 1) Pull categories (be tolerant of missing image/description columns)
    //    We select known fields; image/description are attached via `(row as any)`
    const rowsRaw = await prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        parentId: true,
        // DO NOT select image/description directly to avoid type errors if column missing
      },
    });

    const rows: CatNode[] = rowsRaw.map((r) => {
      const anyRow = r as unknown as Record<string, unknown>;
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        parentId: r.parentId,
        image: (anyRow.image as string | null | undefined) ?? null,
        description: (anyRow.description as string | null | undefined) ?? null,
        productCount: 0, // fill below
      };
    });

    if (rows.length === 0) {
      return NextResponse.json({ rows: [], tree: [] }, { headers: cors });
    }

    // 2) Get product links for all categories
    const links = await prisma.productCategory.findMany({
      select: { categoryId: true, productGid: true },
    });

    // Map: categoryId -> Set(productGid)
    const catToProducts = new Map<string, Set<string>>();
    for (const l of links) {
      if (!catToProducts.has(l.categoryId)) catToProducts.set(l.categoryId, new Set());
      catToProducts.get(l.categoryId)!.add(l.productGid);
    }

    // 3) If YMM provided → intersect via ProductFitment
    let allowedByYMM: Set<string> | null = null;
    const fitWhere = buildFitmentWhere({ year, makeId, modelId, trimId, chassisId });
    if (fitWhere) {
      const fits = await prisma.productFitment.findMany({
        where: fitWhere,
        select: { productGid: true },
      });
      allowedByYMM = new Set(fits.map(f => f.productGid));
    }

    // 4) Populate productCount per category with optional YMM filtering
    for (const node of rows) {
      const set = catToProducts.get(node.id);
      if (!set) {
        node.productCount = 0;
        continue;
      }
      if (!allowedByYMM) {
        node.productCount = set.size;
      } else {
        let count = 0;
        for (const gid of set) {
          if (allowedByYMM.has(gid)) count++;
        }
        node.productCount = count;
      }
    }

    // 5) Build the tree
    const tree = buildTree(rows, null);

    return NextResponse.json({ rows, tree }, { headers: cors });
  } catch (e) {
    console.error('[public/categories] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: cors });
  }
}