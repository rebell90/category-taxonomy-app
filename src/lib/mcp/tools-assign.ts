import prisma from '@/lib/prisma';
import {
  rebuildProductCategoryMetafield,
  rebuildProductFitmentMetafield,
} from '@/lib/product-metafields';
import { shopifyAdminGraphQL } from '@/lib/shopify';
import { ok, toolError, normalizeGid, type ToolResult } from './types';

// ——— Validation helpers ——————————————————————————————————————————————————

async function validateCategoryIds(
  ids: string[],
): Promise<{ valid: string[]; invalid: string[]; archived: string[] }> {
  const rows = await prisma.category.findMany({
    where: { id: { in: ids } },
    select: { id: true, archivedAt: true },
  });
  const found = new Map(rows.map((r) => [r.id, r]));
  const invalid = ids.filter((id) => !found.has(id));
  const archived = ids.filter((id) => found.get(id)?.archivedAt !== null && found.get(id)?.archivedAt !== undefined);
  const valid = ids.filter((id) => found.has(id) && found.get(id)?.archivedAt === null);
  return { valid, invalid, archived };
}

type FitmentInput = {
  makeId: string;
  modelId: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trimId?: string | null;
  chassisId?: string | null;
};

async function validateFitmentRow(
  row: FitmentInput,
  idx: number,
): Promise<string[]> {
  const errors: string[] = [];

  const ids = [row.makeId, row.modelId, row.trimId, row.chassisId].filter(Boolean) as string[];
  const terms = await prisma.fitTerm.findMany({
    where: { id: { in: ids } },
    select: { id: true, type: true, parentId: true },
  });
  const termMap = new Map(terms.map((t) => [t.id, t]));

  const make = termMap.get(row.makeId);
  if (!make) errors.push(`[${idx}] makeId "${row.makeId}" not found`);
  else if (make.type !== 'MAKE') errors.push(`[${idx}] makeId "${row.makeId}" is type ${make.type}, not MAKE`);

  const model = termMap.get(row.modelId);
  if (!model) errors.push(`[${idx}] modelId "${row.modelId}" not found`);
  else if (model.type !== 'MODEL') errors.push(`[${idx}] modelId "${row.modelId}" is type ${model.type}, not MODEL`);
  else if (make && model.parentId !== row.makeId)
    errors.push(`[${idx}] modelId "${row.modelId}" does not belong to makeId "${row.makeId}"`);

  if (row.trimId) {
    const trim = termMap.get(row.trimId);
    if (!trim) errors.push(`[${idx}] trimId "${row.trimId}" not found`);
    else if (trim.type !== 'TRIM') errors.push(`[${idx}] trimId "${row.trimId}" is type ${trim.type}, not TRIM`);
  }

  if (row.chassisId) {
    const chassis = termMap.get(row.chassisId);
    if (!chassis) errors.push(`[${idx}] chassisId "${row.chassisId}" not found`);
    else if (chassis.type !== 'CHASSIS') errors.push(`[${idx}] chassisId "${row.chassisId}" is type ${chassis.type}, not CHASSIS`);
  }

  if (typeof row.yearFrom === 'number' && typeof row.yearTo === 'number' && row.yearFrom > row.yearTo) {
    errors.push(`[${idx}] yearFrom (${row.yearFrom}) must be ≤ yearTo (${row.yearTo})`);
  }

  return errors;
}

// ——— set_product_categories ——————————————————————————————————————————————

export async function handleSetProductCategories(args: {
  productGid: string;
  categoryIds: string[];
  replace?: boolean;
  dry_run?: boolean;
}): Promise<ToolResult> {
  const productGid = normalizeGid(args.productGid);
  const replace = args.replace !== false; // default true
  const dryRun = args.dry_run === true;

  const { invalid, archived } = await validateCategoryIds(args.categoryIds);
  if (invalid.length > 0)
    return toolError(`Unknown category IDs: ${invalid.join(', ')}`);
  if (archived.length > 0)
    return toolError(`Cannot assign archived categories: ${archived.join(', ')}`);

  const targetIds = Array.from(new Set(args.categoryIds));

  // Current state
  const existing = await prisma.productCategory.findMany({
    where: { productGid },
    select: { categoryId: true },
  });
  const beforeIds = existing.map((r) => r.categoryId);
  const beforeSet = new Set(beforeIds);

  const toAdd = targetIds.filter((id) => !beforeSet.has(id));
  const toRemove = replace ? beforeIds.filter((id) => !new Set(targetIds).has(id)) : [];

  if (dryRun) {
    const [addCats, removeCats] = await Promise.all([
      toAdd.length
        ? prisma.category.findMany({ where: { id: { in: toAdd } }, select: { id: true, slug: true, title: true } })
        : Promise.resolve([]),
      toRemove.length
        ? prisma.category.findMany({ where: { id: { in: toRemove } }, select: { id: true, slug: true, title: true } })
        : Promise.resolve([]),
    ]);
    return ok({ dry_run: true, add: addCats, remove: removeCats });
  }

  if (replace) {
    await prisma.productCategory.deleteMany({ where: { productGid } });
    if (targetIds.length) {
      await prisma.productCategory.createMany({
        data: targetIds.map((categoryId) => ({ productGid, categoryId })),
        skipDuplicates: true,
      });
    }
  } else {
    if (toAdd.length) {
      await prisma.productCategory.createMany({
        data: toAdd.map((categoryId) => ({ productGid, categoryId })),
        skipDuplicates: true,
      });
    }
  }

  await rebuildProductCategoryMetafield(productGid);

  return ok({
    productGid,
    replace,
    added: toAdd.length,
    removed: toRemove.length,
    total: targetIds.length,
  });
}

// ——— set_product_fitment ————————————————————————————————————————————————

export async function handleSetProductFitment(args: {
  productGid: string;
  fitments: FitmentInput[];
  replace?: boolean;
  dry_run?: boolean;
}): Promise<ToolResult> {
  const productGid = normalizeGid(args.productGid);
  const replace = args.replace !== false;
  const dryRun = args.dry_run === true;

  if (!args.fitments.length && args.replace === false) return toolError('fitments array cannot be empty when replace=false (nothing to append)');

  // Validate all rows upfront (skip if empty)
  if (args.fitments.length) {
    const allErrors: string[] = [];
    for (let i = 0; i < args.fitments.length; i++) {
      const errs = await validateFitmentRow(args.fitments[i], i);
      allErrors.push(...errs);
    }
    if (allErrors.length) return toolError(allErrors.join('\n'));
  }

  const existing = await prisma.productFitment.findMany({
    where: { productGid },
    select: { id: true, make: true, model: true, trim: true, chassis: true, yearFrom: true, yearTo: true },
  });

  if (dryRun) {
    return ok({
      dry_run: true,
      before: existing,
      after: replace ? args.fitments : [...existing, ...args.fitments],
      add: args.fitments,
      remove: replace ? existing : [],
    });
  }

  if (replace) {
    await prisma.productFitment.deleteMany({ where: { productGid } });
  }

  if (args.fitments.length) {
    await prisma.productFitment.createMany({
      data: args.fitments.map((f) => ({
        productGid,
        make: f.makeId,
        model: f.modelId,
        trim: f.trimId ?? null,
        chassis: f.chassisId ?? null,
        yearFrom: f.yearFrom ?? null,
        yearTo: f.yearTo ?? null,
      })),
      skipDuplicates: true,
    });
  }

  await rebuildProductFitmentMetafield(productGid);

  return ok({
    productGid,
    replace,
    added: args.fitments.length,
    removed: replace ? existing.length : 0,
  });
}

// ——— batch_set_product_categories ———————————————————————————————————————

type BatchCatItem = { productGid: string; categoryIds: string[]; replace?: boolean };

export async function handleBatchSetProductCategories(args: {
  items: BatchCatItem[];
  dry_run?: boolean;
}): Promise<ToolResult> {
  if (args.items.length > 50) return toolError('Maximum 50 items per batch');
  const dryRun = args.dry_run === true;

  const results = await Promise.all(
    args.items.map(async (item) => {
      try {
        const result = await handleSetProductCategories({
          productGid: item.productGid,
          categoryIds: item.categoryIds,
          replace: item.replace,
          dry_run: dryRun,
        });
        return {
          productGid: normalizeGid(item.productGid),
          status: result.isError ? 'error' : 'ok',
          detail: JSON.parse(result.content[0].text),
        };
      } catch (e) {
        return {
          productGid: normalizeGid(item.productGid),
          status: 'error',
          detail: 'Internal error',
        };
      }
    }),
  );

  const ok_count = results.filter((r) => r.status === 'ok').length;
  const err_count = results.filter((r) => r.status === 'error').length;
  return ok({ dry_run: dryRun, ok: ok_count, errors: err_count, results });
}

// ——— batch_set_product_fitment ———————————————————————————————————————————

type BatchFitItem = { productGid: string; fitments: FitmentInput[]; replace?: boolean };

export async function handleBatchSetProductFitment(args: {
  items: BatchFitItem[];
  dry_run?: boolean;
}): Promise<ToolResult> {
  if (args.items.length > 50) return toolError('Maximum 50 items per batch');
  const dryRun = args.dry_run === true;

  const results = await Promise.all(
    args.items.map(async (item) => {
      try {
        const result = await handleSetProductFitment({
          productGid: item.productGid,
          fitments: item.fitments,
          replace: item.replace,
          dry_run: dryRun,
        });
        return {
          productGid: normalizeGid(item.productGid),
          status: result.isError ? 'error' : 'ok',
          detail: JSON.parse(result.content[0].text),
        };
      } catch (e) {
        return {
          productGid: normalizeGid(item.productGid),
          status: 'error',
          detail: 'Internal error',
        };
      }
    }),
  );

  const ok_count = results.filter((r) => r.status === 'ok').length;
  const err_count = results.filter((r) => r.status === 'error').length;
  return ok({ dry_run: dryRun, ok: ok_count, errors: err_count, results });
}

// ——— merge_vehicles ——————————————————————————————————————————————————————

export async function handleMergeVehicles(args: {
  sourceId: string;
  targetId: string;
  dry_run?: boolean;
}): Promise<ToolResult> {
  const dryRun = args.dry_run === true;

  const [source, target] = await Promise.all([
    prisma.fitTerm.findUnique({ where: { id: args.sourceId }, select: { id: true, type: true, name: true, parentId: true } }),
    prisma.fitTerm.findUnique({ where: { id: args.targetId }, select: { id: true, type: true, name: true, parentId: true } }),
  ]);

  if (!source) return toolError(`sourceId "${args.sourceId}" not found`);
  if (!target) return toolError(`targetId "${args.targetId}" not found`);
  if (source.type !== target.type) return toolError(`source type ${source.type} != target type ${target.type}`);

  // Count affected fitment rows for each field role
  const [makeRows, modelRows, trimRows, chassisRows] = await Promise.all([
    prisma.productFitment.count({ where: { make: args.sourceId } }),
    prisma.productFitment.count({ where: { model: args.sourceId } }),
    prisma.productFitment.count({ where: { trim: args.sourceId } }),
    prisma.productFitment.count({ where: { chassis: args.sourceId } }),
  ]);
  const totalAffected = makeRows + modelRows + trimRows + chassisRows;

  if (dryRun) {
    // Collect affected product GIDs (up to 50 samples)
    const affectedRows = await prisma.productFitment.findMany({
      where: {
        OR: [
          { make: args.sourceId },
          { model: args.sourceId },
          { trim: args.sourceId },
          { chassis: args.sourceId },
        ],
      },
      select: { productGid: true },
      distinct: ['productGid'],
      take: 50,
    });
    const sampleGids = affectedRows.map((r) => r.productGid);

    // Fetch titles from Shopify for the sample
    type NodesResp = { nodes: Array<{ __typename: 'Product'; id: string; title: string } | null> };
    const NODES_GQL = `query Nodes($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { __typename id title } } }`;
    let affectedProducts: Array<{ id: string; title: string }> = sampleGids.map((id) => ({ id, title: '' }));
    try {
      const data = await shopifyAdminGraphQL<NodesResp>(NODES_GQL, { ids: sampleGids });
      affectedProducts = (data.nodes || [])
        .filter((n): n is NonNullable<typeof n> => !!n && n.__typename === 'Product')
        .map((n) => ({ id: n.id, title: n.title }));
    } catch { /* titles unavailable, return IDs only */ }

    // Count total unique products (may exceed sample)
    const totalUniqueProducts = await prisma.productFitment.findMany({
      where: {
        OR: [
          { make: args.sourceId },
          { model: args.sourceId },
          { trim: args.sourceId },
          { chassis: args.sourceId },
        ],
      },
      select: { productGid: true },
      distinct: ['productGid'],
    }).then((r) => r.length);

    return ok({
      dry_run: true,
      source: { id: source.id, type: source.type, name: source.name },
      target: { id: target.id, type: target.type, name: target.name },
      fitmentRowsToMove: { as_make: makeRows, as_model: modelRows, as_trim: trimRows, as_chassis: chassisRows, total: totalAffected },
      affectedProductCount: totalUniqueProducts,
      affectedProducts,
      ...(affectedProducts.length < totalUniqueProducts
        ? { note: `Showing first ${affectedProducts.length} of ${totalUniqueProducts} affected products` }
        : {}),
    });
  }

  // Move all fitment rows from source → target
  await prisma.$transaction([
    prisma.productFitment.updateMany({ where: { make: args.sourceId },    data: { make: args.targetId } }),
    prisma.productFitment.updateMany({ where: { model: args.sourceId },   data: { model: args.targetId } }),
    prisma.productFitment.updateMany({ where: { trim: args.sourceId },    data: { trim: args.targetId } }),
    prisma.productFitment.updateMany({ where: { chassis: args.sourceId }, data: { chassis: args.targetId } }),
  ]);

  // Delete the source FitTerm (it's now unused)
  // Note: children of source are NOT moved — caller should merge them separately if needed
  await prisma.fitTerm.delete({ where: { id: args.sourceId } });

  return ok({
    merged: true,
    source: { id: source.id, type: source.type, name: source.name, deleted: true },
    target: { id: target.id, type: target.type, name: target.name },
    fitmentRowsMoved: totalAffected,
  });
}
