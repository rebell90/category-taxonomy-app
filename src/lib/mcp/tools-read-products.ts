import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify';
import { ok, toolError, normalizeGid, type ToolResult } from './types';

// ——— get_product_assignments ————————————————————————————————————————————

export async function handleGetProductAssignments(args: {
  productGid: string;
}): Promise<ToolResult> {
  const productGid = normalizeGid(args.productGid);

  const [categoryLinks, fitmentRows] = await Promise.all([
    prisma.productCategory.findMany({
      where: { productGid },
      select: {
        categoryId: true,
        category: { select: { id: true, title: true, slug: true, archivedAt: true } },
      },
    }),
    prisma.productFitment.findMany({
      where: { productGid },
      select: {
        id: true,
        make: true,
        model: true,
        trim: true,
        chassis: true,
        yearFrom: true,
        yearTo: true,
      },
    }),
  ]);

  // Collect all FitTerm IDs referenced by fitment rows
  const termIds = new Set<string>();
  fitmentRows.forEach((r) => {
    if (r.make) termIds.add(r.make);
    if (r.model) termIds.add(r.model);
    if (r.trim) termIds.add(r.trim);
    if (r.chassis) termIds.add(r.chassis);
  });

  const terms =
    termIds.size > 0
      ? await prisma.fitTerm.findMany({
          where: { id: { in: [...termIds] } },
          select: { id: true, type: true, name: true },
        })
      : [];
  const termMap = new Map(terms.map((t) => [t.id, t]));

  const categories = categoryLinks.map((l) => ({
    id: l.category.id,
    title: l.category.title,
    slug: l.category.slug,
    archived: l.category.archivedAt !== null,
  }));

  const fitment = fitmentRows.map((r) => ({
    id: r.id,
    makeId: r.make,
    makeName: termMap.get(r.make)?.name ?? r.make,
    modelId: r.model,
    modelName: termMap.get(r.model)?.name ?? r.model,
    trimId: r.trim ?? null,
    trimName: r.trim ? (termMap.get(r.trim)?.name ?? r.trim) : null,
    chassisId: r.chassis ?? null,
    chassisName: r.chassis ? (termMap.get(r.chassis)?.name ?? r.chassis) : null,
    yearFrom: r.yearFrom ?? null,
    yearTo: r.yearTo ?? null,
  }));

  return ok({ productGid, categories, fitment });
}

// ——— list_unassigned_products ——————————————————————————————————————————

const PRODUCTS_QUERY = /* GraphQL */ `
  query ListProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id title status }
    }
  }
`;

type ShopifyProductNode = { id: string; title: string; status: string };
type ShopifyProductsData = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
};

export async function handleListUnassignedProducts(args: {
  cursor?: string | null;
  limit?: number;
  filter?: 'missing_categories' | 'missing_fitment' | 'any';
}): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 20, 50);
  const filter = args.filter ?? 'any';

  const data = await shopifyAdminGraphQL<ShopifyProductsData>(PRODUCTS_QUERY, {
    first: limit * 3, // over-fetch because we'll filter
    after: args.cursor ?? null,
  });

  const nodes = data.products?.nodes ?? [];
  const pageInfo = data.products?.pageInfo;
  const gids = nodes.map((n) => n.id);

  if (gids.length === 0) {
    return ok({ products: [], nextCursor: null });
  }

  const [catGids, fitGids] = await Promise.all([
    prisma.productCategory.findMany({
      where: { productGid: { in: gids } },
      select: { productGid: true },
      distinct: ['productGid'],
    }),
    prisma.productFitment.findMany({
      where: { productGid: { in: gids } },
      select: { productGid: true },
      distinct: ['productGid'],
    }),
  ]);

  const hasCat = new Set(catGids.map((r) => r.productGid));
  const hasFit = new Set(fitGids.map((r) => r.productGid));

  const unassigned = nodes
    .filter((n) => {
      const missingCat = !hasCat.has(n.id);
      const missingFit = !hasFit.has(n.id);
      if (filter === 'missing_categories') return missingCat;
      if (filter === 'missing_fitment') return missingFit;
      return missingCat || missingFit; // 'any'
    })
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      missingCategories: !hasCat.has(n.id),
      missingFitment: !hasFit.has(n.id),
    }));

  return ok({
    products: unassigned,
    nextCursor: pageInfo?.hasNextPage ? pageInfo.endCursor : null,
  });
}

// ——— list_vehicles ——————————————————————————————————————————————————————

export async function handleListVehicles(args: {
  type?: string | null;
  parentId?: string | null;
}): Promise<ToolResult> {
  const where: { type?: 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS'; parentId?: string | null } = {};

  if (args.type) {
    const upper = args.type.toUpperCase();
    if (!['MAKE', 'MODEL', 'TRIM', 'CHASSIS'].includes(upper)) {
      return toolError(`Invalid type "${args.type}". Must be MAKE, MODEL, TRIM, or CHASSIS.`);
    }
    where.type = upper as 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';
  }

  if (args.parentId !== undefined) {
    where.parentId = args.parentId;
  }

  const rows = await prisma.fitTerm.findMany({
    where,
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    select: { id: true, type: true, name: true, parentId: true },
  });

  return ok(rows);
}
