// MCP Streamable HTTP endpoint — stateless JSON-RPC 2.0 over POST
// Implements the Model Context Protocol spec (2024-11-05) for Next.js App Router.
//
// Auth:  Authorization: Bearer <key>  (SHA-256 hash stored in ApiKey table)
// Scopes: read | write | assign | catalog | archive
// Env:   MCP_RATE_LIMIT_RPM (default 60) — requests/min per key

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { SHOPIFY_ENABLED, ensureShopifyPageForCategory } from '@/lib/shopify';

// New tool handlers
import {
  handleGetProductAssignments,
  handleListUnassignedProducts,
  handleListVehicles,
} from '@/lib/mcp/tools-read-products';
import {
  handleSetProductCategories,
  handleSetProductFitment,
  handleBatchSetProductCategories,
  handleBatchSetProductFitment,
  handleMergeVehicles,
} from '@/lib/mcp/tools-assign';
import {
  handleCreateMake,
  handleCreateModel,
  handleCreateChassis,
  handleUpdateVehicle,
} from '@/lib/mcp/tools-catalog';
import {
  handlePreviewArchiveCategory,
  handleConfirmArchiveCategory,
} from '@/lib/mcp/tools-archive';
import { type ToolResult } from '@/lib/mcp/types';

// ——— Rate limiting ————————————————————————————————————————————————————————
// In-memory sliding window. Resets on deploy; not shared across instances.
// Swap for Upstash Redis if you scale beyond 1 Render instance.
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_RPM = Math.max(1, parseInt(process.env.MCP_RATE_LIMIT_RPM ?? '60', 10));

function checkRateLimit(keyName: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(keyName);
  if (!entry || now - entry.windowStart > 60_000) {
    rateLimitMap.set(keyName, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_RPM) return false;
  entry.count++;
  return true;
}

// ——— Auth ——————————————————————————————————————————————————————————————————

function constantTimeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aBuf = Buffer.from(a.padEnd(maxLen, '\0'));
  const bBuf = Buffer.from(b.padEnd(maxLen, '\0'));
  return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

type AuthResult = { keyName: string; scopes: string[] };

async function authenticate(request: Request): Promise<AuthResult | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const plaintext = authHeader.slice(7).trim();
  if (!plaintext) return null;

  const incomingHash = createHash('sha256').update(plaintext).digest('hex');
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: incomingHash },
    select: { id: true, name: true, keyHash: true, scopes: true, revokedAt: true },
  });

  if (!key) return null;
  if (!constantTimeEqual(key.keyHash, incomingHash)) return null;
  if (key.revokedAt !== null) return null;

  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { keyName: key.name, scopes: key.scopes };
}

// ——— Audit logging ————————————————————————————————————————————————————————

type AuditStatus = 'success' | 'error' | 'unauthorized' | 'rate_limited';

async function audit(keyName: string, tool: string, inputs: unknown, status: AuditStatus) {
  try {
    await prisma.mcpAuditLog.create({
      data: { keyName, tool, inputsJson: JSON.stringify(inputs), resultStatus: status },
    });
  } catch (e) {
    console.error('[mcp:audit] Failed', e);
  }
}

// ——— Scope requirements ———————————————————————————————————————————————————

const TOOL_SCOPE: Record<string, string> = {
  // read
  list_categories: 'read',
  search_categories: 'read',
  get_category: 'read',
  get_product_assignments: 'read',
  list_unassigned_products: 'read',
  list_vehicles: 'read',
  // write
  create_category: 'write',
  update_category: 'write',
  // assign
  set_product_categories: 'assign',
  set_product_fitment: 'assign',
  batch_set_product_categories: 'assign',
  batch_set_product_fitment: 'assign',
  // catalog
  create_make: 'catalog',
  create_model: 'catalog',
  create_chassis: 'catalog',
  update_vehicle: 'catalog',
  merge_vehicles: 'catalog',
  // archive
  preview_archive_category: 'archive',
  confirm_archive_category: 'archive',
};

// ——— Zod schemas ——————————————————————————————————————————————————————————

const SlugField = z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens');

// existing
const ListCategoriesInput = z.object({
  compact: z.boolean().optional(),
  cursor: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict();
const SearchCategoriesInput = z.object({ query: z.string().min(1).max(200) }).strict();
const GetCategoryInput = z.object({ id: z.string().min(1).max(50) }).strict();
const CreateCategoryInput = z.object({
  title: z.string().min(1).max(200),
  slug: SlugField,
  parentId: z.string().max(50).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  image: z.string().url().max(2000).nullable().optional(),
}).strict();
const UpdateCategoryInput = z.object({
  id: z.string().min(1).max(50),
  title: z.string().min(1).max(200).optional(),
  slug: SlugField.optional(),
  parentId: z.string().max(50).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  image: z.string().url().max(2000).nullable().optional(),
}).strict();

// read-products
const GetProductAssignmentsInput = z.object({ productGid: z.string().min(1).max(200) }).strict();
const ListUnassignedProductsInput = z.object({
  cursor: z.string().max(500).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  filter: z.enum(['missing_categories', 'missing_fitment', 'any']).optional(),
}).strict();
const ListVehiclesInput = z.object({
  type: z.enum(['MAKE', 'MODEL', 'TRIM', 'CHASSIS']).optional(),
  parentId: z.string().max(50).nullable().optional(),
}).strict();

// assign
const FitmentRowInput = z.object({
  makeId: z.string().min(1).max(50),
  modelId: z.string().min(1).max(50),
  yearFrom: z.number().int().min(1900).max(2100).nullable().optional(),
  yearTo: z.number().int().min(1900).max(2100).nullable().optional(),
  trimId: z.string().max(50).nullable().optional(),
  chassisId: z.string().max(50).nullable().optional(),
});
const SetProductCategoriesInput = z.object({
  productGid: z.string().min(1).max(200),
  categoryIds: z.array(z.string().min(1).max(50)).min(0).max(100),
  replace: z.boolean().optional(),
  dry_run: z.boolean().optional(),
}).strict();
const SetProductFitmentInput = z.object({
  productGid: z.string().min(1).max(200),
  fitments: z.array(FitmentRowInput).min(0).max(200),
  replace: z.boolean().optional(),
  dry_run: z.boolean().optional(),
}).strict();
const BatchSetProductCategoriesInput = z.object({
  items: z.array(z.object({
    productGid: z.string().min(1).max(200),
    categoryIds: z.array(z.string().min(1).max(50)).min(0).max(100),
    replace: z.boolean().optional(),
  })).min(1).max(50),
  dry_run: z.boolean().optional(),
}).strict();
const BatchSetProductFitmentInput = z.object({
  items: z.array(z.object({
    productGid: z.string().min(1).max(200),
    fitments: z.array(FitmentRowInput).min(0).max(200),
    replace: z.boolean().optional(),
  })).min(1).max(50),
  dry_run: z.boolean().optional(),
}).strict();

// catalog
const NameInput = z.string().min(1).max(200).transform((s) => s.trim());
const CreateMakeInput = z.object({ name: NameInput }).strict();
const CreateModelInput = z.object({ name: NameInput, makeId: z.string().min(1).max(50) }).strict();
const CreateChassisInput = z.object({ name: NameInput, parentId: z.string().min(1).max(50) }).strict();
const UpdateVehicleInput = z.object({ id: z.string().min(1).max(50), name: NameInput }).strict();
const MergeVehiclesInput = z.object({
  sourceId: z.string().min(1).max(50),
  targetId: z.string().min(1).max(50),
  dry_run: z.boolean().optional(),
}).strict();

// archive
const PreviewArchiveCategoryInput = z.object({ id: z.string().min(1).max(50) }).strict();
const ConfirmArchiveCategoryInput = z.object({ token: z.string().min(1).max(50) }).strict();

// ——— Tool definitions (MCP schema) ————————————————————————————————————————

const TOOLS = [
  // ── read ──
  {
    name: 'list_categories',
    description: 'List all categories in the taxonomy tree. Use compact=true to omit description field. Use cursor+limit for pagination (default limit 200, max 500).',
    inputSchema: {
      type: 'object',
      properties: {
        compact: { type: 'boolean', default: false, description: 'Omit description field to reduce response size' },
        cursor: { type: 'string', maxLength: 50, description: 'Pagination cursor (id of last item from previous page)' },
        limit: { type: 'number', minimum: 1, maximum: 500, default: 200 },
      },
    },
  },
  {
    name: 'search_categories',
    description: 'Search categories by title (case-insensitive partial match).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['query'],
    },
  },
  {
    name: 'get_category',
    description: 'Get a single category by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, maxLength: 50 } },
      required: ['id'],
    },
  },
  {
    name: 'get_product_assignments',
    description: "Return a product's current category and fitment assignments, with FitTerm IDs and names.",
    inputSchema: {
      type: 'object',
      properties: { productGid: { type: 'string', description: 'Shopify product GID or numeric ID' } },
      required: ['productGid'],
    },
  },
  {
    name: 'list_unassigned_products',
    description: 'Paginated list of Shopify products missing category and/or fitment assignments.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
        limit: { type: 'number', minimum: 1, maximum: 50, default: 20 },
        filter: { type: 'string', enum: ['missing_categories', 'missing_fitment', 'any'], default: 'any' },
      },
    },
  },
  {
    name: 'list_vehicles',
    description: 'List FitTerms (makes, models, chassis, trims) with their picker IDs. Filter by type or parentId.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['MAKE', 'MODEL', 'TRIM', 'CHASSIS'] },
        parentId: { type: 'string', description: 'Filter by parent FitTerm ID' },
      },
    },
  },
  // ── write ──
  {
    name: 'create_category',
    description: 'Create a new category. Triggers Shopify page sync.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        slug: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-z0-9-]+$' },
        parentId: { type: 'string', maxLength: 50, nullable: true },
        description: { type: 'string', maxLength: 5000, nullable: true },
        image: { type: 'string', maxLength: 2000, nullable: true },
      },
      required: ['title', 'slug'],
    },
  },
  {
    name: 'update_category',
    description: 'Update an existing category. Triggers Shopify page sync.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 50 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        slug: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-z0-9-]+$' },
        parentId: { type: 'string', maxLength: 50, nullable: true },
        description: { type: 'string', maxLength: 5000, nullable: true },
        image: { type: 'string', maxLength: 2000, nullable: true },
      },
      required: ['id'],
    },
  },
  // ── assign ──
  {
    name: 'set_product_categories',
    description:
      'Assign categories to a product. replace=true (default) replaces all existing assignments; replace=false appends. dry_run=true returns a diff without writing. Idempotent. Triggers taxonomy.category_slugs metafield sync. Pass categoryIds: [] with replace: true to clear all categories.',
    inputSchema: {
      type: 'object',
      properties: {
        productGid: { type: 'string' },
        categoryIds: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 100 },
        replace: { type: 'boolean', default: true },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['productGid', 'categoryIds'],
    },
  },
  {
    name: 'set_product_fitment',
    description:
      'Set fitment rows for a product using FitTerm IDs (from list_vehicles). Both makeId and modelId are required. replace=true (default) replaces all; replace=false appends. dry_run=true returns diff. Triggers fitment.ymm metafield sync. Pass fitments: [] with replace: true to clear all fitment.',
    inputSchema: {
      type: 'object',
      properties: {
        productGid: { type: 'string' },
        fitments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              makeId: { type: 'string' },
              modelId: { type: 'string' },
              yearFrom: { type: 'number', nullable: true },
              yearTo: { type: 'number', nullable: true },
              trimId: { type: 'string', nullable: true },
              chassisId: { type: 'string', nullable: true },
            },
            required: ['makeId', 'modelId'],
          },
          minItems: 0,
          maxItems: 200,
        },
        replace: { type: 'boolean', default: true },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['productGid', 'fitments'],
    },
  },
  {
    name: 'batch_set_product_categories',
    description: 'Set categories for up to 50 products in one call. Each item succeeds or fails independently. Pass categoryIds: [] with replace: true to clear all categories.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productGid: { type: 'string' },
              categoryIds: { type: 'array', items: { type: 'string' } },
              replace: { type: 'boolean' },
            },
            required: ['productGid', 'categoryIds'],
          },
          minItems: 1,
          maxItems: 50,
        },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['items'],
    },
  },
  {
    name: 'batch_set_product_fitment',
    description: 'Set fitment for up to 50 products in one call. Each item succeeds or fails independently. Pass fitments: [] with replace: true to clear all fitment.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productGid: { type: 'string' },
              fitments: { type: 'array', items: { type: 'object' } },
              replace: { type: 'boolean' },
            },
            required: ['productGid', 'fitments'],
          },
          minItems: 1,
          maxItems: 50,
        },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['items'],
    },
  },
  // ── catalog ──
  {
    name: 'create_make',
    description: 'Create a vehicle make (top-level FitTerm). Rejects exact and near-duplicate names.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['name'],
    },
  },
  {
    name: 'create_model',
    description: 'Create a vehicle model under a make. Requires a valid makeId. Rejects near-duplicates within that make.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        makeId: { type: 'string', description: 'FitTerm ID of the parent MAKE' },
      },
      required: ['name', 'makeId'],
    },
  },
  {
    name: 'create_chassis',
    description: 'Create a chassis code under a make or model. Requires a valid parentId (MAKE or MODEL).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        parentId: { type: 'string', description: 'FitTerm ID of a MAKE or MODEL' },
      },
      required: ['name', 'parentId'],
    },
  },
  {
    name: 'update_vehicle',
    description: 'Rename any FitTerm (make, model, chassis, trim). Rejects near-duplicate names among siblings.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', minLength: 1, maxLength: 200 },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'merge_vehicles',
    description: 'Move all product fitment rows from one FitTerm (source) to another (target) of the same type, then delete the source. Use dry_run=true to preview. Source and target must be the same type (MAKE/MODEL/CHASSIS/TRIM). Does not move child FitTerms — merge those separately.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'FitTerm ID to merge FROM (will be deleted)' },
        targetId: { type: 'string', description: 'FitTerm ID to merge INTO (kept)' },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['sourceId', 'targetId'],
    },
  },
  // ── archive ──
  {
    name: 'preview_archive_category',
    description:
      'Returns an impact summary (affected products, children) and a single-use confirm token valid for 5 minutes. No data is changed.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'confirm_archive_category',
    description:
      'Soft-deletes a category using a token from preview_archive_category. Blocked if products or active children remain.',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string', description: 'confirmToken from preview_archive_category' } },
      required: ['token'],
    },
  },
];

// ——— Existing category tool handlers (inline, unchanged) ——————————————————

function okInline(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
function toolErrorInline(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function handleListCategories(args?: { compact?: boolean; cursor?: string; limit?: number }): Promise<ToolResult> {
  const pageSize = args?.limit ?? 200;
  const rows = await prisma.category.findMany({
    where: { archivedAt: null, ...(args?.cursor ? { id: { gt: args.cursor } } : {}) },
    orderBy: [{ id: 'asc' }],
    select: args?.compact
      ? { id: true, title: true, slug: true, parentId: true }
      : { id: true, title: true, slug: true, parentId: true, description: true },
    take: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;
  return okInline({ items, nextCursor, total: items.length });
}

async function handleSearchCategories(args: { query: string }): Promise<ToolResult> {
  const rows = await prisma.category.findMany({
    where: { archivedAt: null, title: { contains: args.query, mode: 'insensitive' } },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, slug: true, parentId: true, description: true },
    take: 50,
  });
  return okInline(rows);
}

async function handleGetCategory(args: { id: string }): Promise<ToolResult> {
  const cat = await prisma.category.findUnique({
    where: { id: args.id },
    select: { id: true, title: true, slug: true, parentId: true, description: true, archivedAt: true },
  });
  if (!cat) return toolErrorInline('Category not found');
  return okInline(cat);
}

async function handleCreateCategory(args: z.infer<typeof CreateCategoryInput>): Promise<ToolResult> {
  const created = await prisma.category.create({
    data: {
      title: args.title, slug: args.slug,
      parentId: args.parentId ?? null,
      description: args.description ?? null,
      image: args.image ?? null,
    },
    select: { id: true, title: true, slug: true, parentId: true, description: true, shopifyPageId: true },
  });

  if (SHOPIFY_ENABLED) {
    try {
      const res = await ensureShopifyPageForCategory({
        id: created.id, title: created.title,
        description: created.description, slug: created.slug,
        shopifyPageId: created.shopifyPageId,
      });
      if (res.id || res.handle) {
        await prisma.category.update({
          where: { id: created.id },
          data: { shopifyPageId: res.id, shopifyHandle: res.handle, lastSyncedAt: new Date() },
        });
      }
    } catch (e) { console.error('[mcp:create_category] Shopify sync failed', e); }
  }

  return okInline({ id: created.id, title: created.title, slug: created.slug });
}

async function handleUpdateCategory(args: z.infer<typeof UpdateCategoryInput>): Promise<ToolResult> {
  const existing = await prisma.category.findUnique({ where: { id: args.id }, select: { id: true } });
  if (!existing) return toolErrorInline('Category not found');

  const data: Record<string, unknown> = {};
  if (args.title !== undefined) data.title = args.title;
  if (args.slug !== undefined) data.slug = args.slug;
  if (args.parentId !== undefined) data.parentId = args.parentId;
  if (args.description !== undefined) data.description = args.description;
  if (args.image !== undefined) data.image = args.image;

  const updated = await prisma.category.update({
    where: { id: args.id },
    data,
    select: { id: true, title: true, slug: true, parentId: true, description: true, shopifyPageId: true },
  });

  if (SHOPIFY_ENABLED) {
    try {
      const res = await ensureShopifyPageForCategory({
        id: updated.id, title: updated.title,
        description: updated.description, slug: updated.slug,
        shopifyPageId: updated.shopifyPageId,
      });
      if (res.id || res.handle) {
        await prisma.category.update({
          where: { id: updated.id },
          data: { shopifyPageId: res.id, shopifyHandle: res.handle, lastSyncedAt: new Date() },
        });
      }
    } catch (e) { console.error('[mcp:update_category] Shopify sync failed', e); }
  }

  return okInline({ id: updated.id, title: updated.title, slug: updated.slug });
}

// ——— Tool dispatch ————————————————————————————————————————————————————————

async function dispatchTool(
  name: string,
  args: unknown,
  scopes: string[],
  keyName: string,
): Promise<ToolResult> {
  const requiredScope = TOOL_SCOPE[name];
  if (requiredScope && !scopes.includes(requiredScope)) {
    await audit(keyName, name, args, 'unauthorized');
    return toolErrorInline(`This key requires the "${requiredScope}" scope to call "${name}"`);
  }

  try {
    let result: ToolResult;

    switch (name) {
      // ── read ──
      case 'list_categories':
        result = await handleListCategories(ListCategoriesInput.parse(args ?? {}));
        break;
      case 'search_categories':
        result = await handleSearchCategories(SearchCategoriesInput.parse(args));
        break;
      case 'get_category':
        result = await handleGetCategory(GetCategoryInput.parse(args));
        break;
      case 'get_product_assignments':
        result = await handleGetProductAssignments(GetProductAssignmentsInput.parse(args));
        break;
      case 'list_unassigned_products':
        result = await handleListUnassignedProducts(ListUnassignedProductsInput.parse(args ?? {}));
        break;
      case 'list_vehicles':
        result = await handleListVehicles(ListVehiclesInput.parse(args ?? {}));
        break;
      // ── write ──
      case 'create_category':
        result = await handleCreateCategory(CreateCategoryInput.parse(args));
        break;
      case 'update_category':
        result = await handleUpdateCategory(UpdateCategoryInput.parse(args));
        break;
      // ── assign ──
      case 'set_product_categories':
        result = await handleSetProductCategories(SetProductCategoriesInput.parse(args));
        break;
      case 'set_product_fitment':
        result = await handleSetProductFitment(SetProductFitmentInput.parse(args));
        break;
      case 'batch_set_product_categories':
        result = await handleBatchSetProductCategories(BatchSetProductCategoriesInput.parse(args));
        break;
      case 'batch_set_product_fitment':
        result = await handleBatchSetProductFitment(BatchSetProductFitmentInput.parse(args));
        break;
      // ── catalog ──
      case 'create_make':
        result = await handleCreateMake(CreateMakeInput.parse(args));
        break;
      case 'create_model':
        result = await handleCreateModel(CreateModelInput.parse(args));
        break;
      case 'create_chassis':
        result = await handleCreateChassis(CreateChassisInput.parse(args));
        break;
      case 'update_vehicle':
        result = await handleUpdateVehicle(UpdateVehicleInput.parse(args));
        break;
      case 'merge_vehicles':
        result = await handleMergeVehicles(MergeVehiclesInput.parse(args));
        break;
      // ── archive ──
      case 'preview_archive_category':
        result = await handlePreviewArchiveCategory(PreviewArchiveCategoryInput.parse(args));
        break;
      case 'confirm_archive_category':
        result = await handleConfirmArchiveCategory(ConfirmArchiveCategoryInput.parse(args));
        break;
      default:
        return toolErrorInline(`Unknown tool: ${name}`);
    }

    await audit(keyName, name, args, result.isError ? 'error' : 'success');
    return result;
  } catch (e) {
    if (e instanceof z.ZodError) {
      await audit(keyName, name, args, 'error');
      return toolErrorInline(
        `Invalid arguments: ${e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`,
      );
    }
    console.error(`[mcp:${name}]`, e instanceof Error ? e.message : e);
    await audit(keyName, name, args, 'error');
    return toolErrorInline('Internal error');
  }
}

// ——— JSON-RPC helpers —————————————————————————————————————————————————————

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function rpcError(id: RpcId, code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });
}

// ——— Route handler ————————————————————————————————————————————————————————
// /api/mcp is excluded from the NextAuth middleware matcher in src/middleware.ts.
// Bearer-token auth is handled here.

export async function POST(request: NextRequest) {
  // 1. Auth
  const authResult = await authenticate(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { keyName, scopes } = authResult;

  // 2. Rate limit
  if (!checkRateLimit(keyName)) {
    await audit(keyName, 'rate_limit_exceeded', {}, 'rate_limited');
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // 3. Parse JSON-RPC body
  let body: unknown;
  try { body = await request.json(); }
  catch { return rpcError(null, -32700, 'Parse error'); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return rpcError(null, -32600, 'Invalid Request');
  }

  const rpc = body as { jsonrpc?: unknown; method?: unknown; params?: unknown; id?: unknown };
  const id = (rpc.id ?? null) as RpcId;

  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return rpcError(id, -32600, 'Invalid Request');
  }

  // 4. Dispatch MCP methods
  switch (rpc.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'category-taxonomy', version: '2.0.0' },
      });
    case 'notifications/initialized':
      return new Response(null, { status: 204 });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const params = rpc.params as { name?: string; arguments?: unknown } | undefined;
      if (!params?.name || typeof params.name !== 'string') {
        return rpcError(id, -32602, 'Missing tool name');
      }
      const result = await dispatchTool(params.name, params.arguments ?? {}, scopes, keyName);
      return rpcResult(id, result);
    }
    default:
      return rpcError(id, -32601, 'Method not found', 404);
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'This MCP server is stateless. Use POST with JSON-RPC messages.' },
    { status: 405 },
  );
}

export async function DELETE() {
  return new Response(null, { status: 204 });
}
