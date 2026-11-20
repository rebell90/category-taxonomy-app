// MCP Streamable HTTP endpoint — stateless JSON-RPC 2.0 over POST
// Implements the Model Context Protocol spec (2024-11-05) directly for
// Next.js App Router. The @modelcontextprotocol/sdk transport layer
// requires Node.js IncomingMessage/ServerResponse; we implement the
// protocol layer here and use the SDK types for correctness.
//
// Auth: Authorization: Bearer <key>  (SHA-256 key hash stored in ApiKey table)
// New env var: MCP_RATE_LIMIT_RPM (default 60) — requests per minute per key

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { SHOPIFY_ENABLED, ensureShopifyPageForCategory } from '@/lib/shopify';

// ——— Rate limiting (in-memory, per-key sliding window) ———————————————————
// NOTE: Resets on deploy and does not synchronize across multiple instances.
// Swap the Map for Upstash Redis if you scale to >1 Render instance.
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
  // Pad to equal length before comparing so timingSafeEqual doesn't throw
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

  // Fire-and-forget last-used timestamp
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { keyName: key.name, scopes: key.scopes };
}

// ——— Audit logging ————————————————————————————————————————————————————————

type AuditStatus = 'success' | 'error' | 'unauthorized' | 'rate_limited';

async function audit(
  keyName: string,
  tool: string,
  inputs: unknown,
  status: AuditStatus,
) {
  try {
    await prisma.mcpAuditLog.create({
      data: { keyName, tool, inputsJson: JSON.stringify(inputs), resultStatus: status },
    });
  } catch (e) {
    console.error('[mcp:audit] Failed to write audit log', e);
  }
}

// ——— Zod input schemas ————————————————————————————————————————————————————

const ListCategoriesInput = z.object({}).strict();

const SearchCategoriesInput = z
  .object({ query: z.string().min(1).max(200) })
  .strict();

const GetCategoryInput = z
  .object({ id: z.string().min(1).max(50) })
  .strict();

const SlugField = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens');

const CreateCategoryInput = z
  .object({
    title: z.string().min(1).max(200),
    slug: SlugField,
    parentId: z.string().max(50).nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    image: z.string().url().max(2000).nullable().optional(),
  })
  .strict();

const UpdateCategoryInput = z
  .object({
    id: z.string().min(1).max(50),
    title: z.string().min(1).max(200).optional(),
    slug: SlugField.optional(),
    parentId: z.string().max(50).nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    image: z.string().url().max(2000).nullable().optional(),
  })
  .strict();

// ——— MCP tool definitions ————————————————————————————————————————————————

const TOOLS = [
  {
    name: 'list_categories',
    description: 'List all categories in the taxonomy tree.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_categories',
    description: 'Search categories by title (case-insensitive, partial match).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term', minLength: 1, maxLength: 200 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_category',
    description: 'Get a single category by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Category cuid', minLength: 1, maxLength: 50 },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_category',
    description: 'Create a new category. Requires write scope. Triggers Shopify page sync.',
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
    description: 'Update an existing category. Requires write scope. Triggers Shopify page sync.',
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
];

// ——— Tool handlers ————————————————————————————————————————————————————————

type ToolContent = { type: 'text'; text: string };
type ToolResult = { content: ToolContent[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function handleListCategories(): Promise<ToolResult> {
  const rows = await prisma.category.findMany({
    orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
    select: { id: true, title: true, slug: true, parentId: true, description: true },
  });
  return ok(rows);
}

async function handleSearchCategories(
  args: z.infer<typeof SearchCategoriesInput>,
): Promise<ToolResult> {
  const rows = await prisma.category.findMany({
    where: { title: { contains: args.query, mode: 'insensitive' } },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, slug: true, parentId: true, description: true },
    take: 50,
  });
  return ok(rows);
}

async function handleGetCategory(
  args: z.infer<typeof GetCategoryInput>,
): Promise<ToolResult> {
  const cat = await prisma.category.findUnique({
    where: { id: args.id },
    select: { id: true, title: true, slug: true, parentId: true, description: true },
  });
  if (!cat) return toolError('Category not found');
  return ok(cat);
}

async function handleCreateCategory(
  args: z.infer<typeof CreateCategoryInput>,
): Promise<ToolResult> {
  const created = await prisma.category.create({
    data: {
      title: args.title,
      slug: args.slug,
      parentId: args.parentId ?? null,
      description: args.description ?? null,
      image: args.image ?? null,
    },
    select: {
      id: true, title: true, slug: true, parentId: true,
      description: true, shopifyPageId: true,
    },
  });

  if (SHOPIFY_ENABLED) {
    try {
      const res = await ensureShopifyPageForCategory({
        id: created.id,
        title: created.title,
        description: created.description,
        slug: created.slug,
        shopifyPageId: created.shopifyPageId,
      });
      if (res.id || res.handle) {
        await prisma.category.update({
          where: { id: created.id },
          data: { shopifyPageId: res.id, shopifyHandle: res.handle, lastSyncedAt: new Date() },
        });
      }
    } catch (e) {
      console.error('[mcp:create_category] Shopify sync failed', e);
    }
  }

  return ok({ id: created.id, title: created.title, slug: created.slug });
}

async function handleUpdateCategory(
  args: z.infer<typeof UpdateCategoryInput>,
): Promise<ToolResult> {
  const existing = await prisma.category.findUnique({
    where: { id: args.id },
    select: { id: true },
  });
  if (!existing) return toolError('Category not found');

  const data: Record<string, unknown> = {};
  if (args.title !== undefined) data.title = args.title;
  if (args.slug !== undefined) data.slug = args.slug;
  if (args.parentId !== undefined) data.parentId = args.parentId;
  if (args.description !== undefined) data.description = args.description;
  if (args.image !== undefined) data.image = args.image;

  const updated = await prisma.category.update({
    where: { id: args.id },
    data,
    select: {
      id: true, title: true, slug: true, parentId: true,
      description: true, shopifyPageId: true,
    },
  });

  if (SHOPIFY_ENABLED) {
    try {
      const res = await ensureShopifyPageForCategory({
        id: updated.id,
        title: updated.title,
        description: updated.description,
        slug: updated.slug,
        shopifyPageId: updated.shopifyPageId,
      });
      if (res.id || res.handle) {
        await prisma.category.update({
          where: { id: updated.id },
          data: { shopifyPageId: res.id, shopifyHandle: res.handle, lastSyncedAt: new Date() },
        });
      }
    } catch (e) {
      console.error('[mcp:update_category] Shopify sync failed', e);
    }
  }

  return ok({ id: updated.id, title: updated.title, slug: updated.slug });
}

// ——— Tool dispatch ————————————————————————————————————————————————————————

const WRITE_TOOLS = new Set(['create_category', 'update_category']);

async function dispatchTool(
  name: string,
  args: unknown,
  scopes: string[],
  keyName: string,
): Promise<ToolResult> {
  if (WRITE_TOOLS.has(name) && !scopes.includes('write')) {
    await audit(keyName, name, args, 'unauthorized');
    return toolError('This key does not have write scope');
  }

  try {
    let result: ToolResult;

    switch (name) {
      case 'list_categories':
        ListCategoriesInput.parse(args ?? {});
        result = await handleListCategories();
        break;
      case 'search_categories':
        result = await handleSearchCategories(SearchCategoriesInput.parse(args));
        break;
      case 'get_category':
        result = await handleGetCategory(GetCategoryInput.parse(args));
        break;
      case 'create_category':
        result = await handleCreateCategory(CreateCategoryInput.parse(args));
        break;
      case 'update_category':
        result = await handleUpdateCategory(UpdateCategoryInput.parse(args));
        break;
      default:
        return toolError(`Unknown tool: ${name}`);
    }

    await audit(keyName, name, args, result.isError ? 'error' : 'success');
    return result;
  } catch (e) {
    if (e instanceof z.ZodError) {
      await audit(keyName, name, args, 'error');
      return toolError(
        `Invalid arguments: ${e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`,
      );
    }
    console.error(`[mcp:${name}]`, e instanceof Error ? e.message : e);
    await audit(keyName, name, args, 'error');
    return toolError('Internal error');
  }
}

// ——— JSON-RPC helpers —————————————————————————————————————————————————————

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function rpcError(id: RpcId, code: number, message: string, status = 400) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status },
  );
}

// ——— Route handler ————————————————————————————————————————————————————————
// /api/mcp is intentionally excluded from the NextAuth middleware matcher in
// middleware.js — bearer-token auth is handled here instead.

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
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

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
        serverInfo: { name: 'category-taxonomy', version: '1.0.0' },
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

// GET / DELETE — stateless server has no SSE streams or sessions
export async function GET() {
  return NextResponse.json(
    { error: 'This MCP server is stateless. Use POST with JSON-RPC messages.' },
    { status: 405 },
  );
}

export async function DELETE() {
  return new Response(null, { status: 204 });
}
