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

  let cursor = args.cursor ?? null;
  const collected: Array<{
    id: string; title: string; status: string;
    missingCategories: boolean; missingFitment: boolean;
  }> = [];
  let nextCursor: string | null = null;
  const MAX_ITERS = 40; // safety cap: ~2000 Shopify products

  for (let i = 0; i < MAX_ITERS && collected.length < limit; i++) {
    const data = await shopifyAdminGraphQL<ShopifyProductsData>(PRODUCTS_QUERY, {
      first: 50,
      after: cursor,
    });

    const nodes = data.products?.nodes ?? [];
    const pageInfo = data.products?.pageInfo;

    if (nodes.length === 0) break;

    const gids = nodes.map((n) => n.id);
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

    for (const n of nodes) {
      if (collected.length >= limit) break;
      const missingCat = !hasCat.has(n.id);
      const missingFit = !hasFit.has(n.id);
      const matches =
        filter === 'missing_categories' ? missingCat
        : filter === 'missing_fitment'  ? missingFit
        : missingCat || missingFit;
      if (matches) {
        collected.push({ id: n.id, title: n.title, status: n.status, missingCategories: missingCat, missingFitment: missingFit });
      }
    }

    if (!pageInfo?.hasNextPage) {
      nextCursor = null;
      break;
    }

    cursor = pageInfo.endCursor;
    if (collected.length >= limit) {
      nextCursor = cursor;
    }
  }

  return ok({ products: collected, nextCursor });
}

// ——— get_assignment_stats ————————————————————————————————————————————————

const PRODUCTS_COUNT_QUERY = /* GraphQL */ `
  query { productsCount { count } }
`;

export async function handleGetAssignmentStats(): Promise<ToolResult> {
  const [countData, catGids, fitGids] = await Promise.all([
    shopifyAdminGraphQL<{ productsCount: { count: number } }>(PRODUCTS_COUNT_QUERY, {}),
    prisma.productCategory.findMany({ select: { productGid: true }, distinct: ['productGid'] }),
    prisma.productFitment.findMany({ select: { productGid: true }, distinct: ['productGid'] }),
  ]);

  const totalShopify = countData.productsCount?.count ?? 0;
  const catSet = new Set(catGids.map((r) => r.productGid));
  const fitSet = new Set(fitGids.map((r) => r.productGid));
  const withBoth = [...catSet].filter((g) => fitSet.has(g)).length;
  const withEither = new Set([...catSet, ...fitSet]).size;

  return ok({
    totalShopifyProducts: totalShopify,
    withCategories: catSet.size,
    withFitment: fitSet.size,
    withBoth,
    withEither,
    withNeither: Math.max(0, totalShopify - withEither),
  });
}

// ——— list_shopify_only_fitment ——————————————————————————————————————————

const PRODUCTS_YMM_QUERY = /* GraphQL */ `
  query ListProductsYmm($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title
        fitmentYmm: metafield(namespace: "fitment", key: "ymm") { value }
      }
    }
  }
`;

type ShopifyYmmNode = { id: string; title: string; fitmentYmm: { value: string } | null };
type ShopifyYmmData = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyYmmNode[];
  };
};

export async function handleListShopifyOnlyFitment(args: {
  cursor?: string | null;
  limit?: number;
}): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 20, 50);

  let cursor = args.cursor ?? null;
  const collected: Array<{ id: string; title: string; shopifyYmmValue: string }> = [];
  let nextCursor: string | null = null;
  const MAX_ITERS = 40;

  for (let i = 0; i < MAX_ITERS && collected.length < limit; i++) {
    const data = await shopifyAdminGraphQL<ShopifyYmmData>(PRODUCTS_YMM_QUERY, {
      first: 50,
      after: cursor,
    });

    const nodes = data.products?.nodes ?? [];
    const pageInfo = data.products?.pageInfo;

    if (nodes.length === 0) break;

    const withYmm = nodes.filter((n) => n.fitmentYmm?.value);
    if (withYmm.length > 0) {
      const gids = withYmm.map((n) => n.id);
      const appFitRows = await prisma.productFitment.findMany({
        where: { productGid: { in: gids } },
        select: { productGid: true },
        distinct: ['productGid'],
      });
      const hasAppFit = new Set(appFitRows.map((r) => r.productGid));

      for (const n of withYmm) {
        if (collected.length >= limit) break;
        if (!hasAppFit.has(n.id)) {
          collected.push({ id: n.id, title: n.title, shopifyYmmValue: n.fitmentYmm!.value });
        }
      }
    }

    if (!pageInfo?.hasNextPage) {
      nextCursor = null;
      break;
    }

    cursor = pageInfo.endCursor;
    if (collected.length >= limit) {
      nextCursor = cursor;
    }
  }

  return ok({ products: collected, nextCursor });
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
