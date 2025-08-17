// src/lib/shopify.ts
// (No eslint any needed; we use unknown-friendly types)

const RAW_SHOP = process.env.SHOPIFY_SHOP ?? ''; // e.g. "mrjmdj-wq" OR "mrjmdj-wq.myshopify.com"
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN ?? '';
export const ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION ?? '2025-07';

// Normalize: accept subdomain or full domain
export const SHOP_DOMAIN = RAW_SHOP.includes('.')
  ? RAW_SHOP
  : `${RAW_SHOP}.myshopify.com`;

if (!RAW_SHOP || !TOKEN) {
  // Don’t throw during build; just warn so environments can start
  console.warn('⚠️ Missing SHOPIFY_SHOP or SHOPIFY_ADMIN_TOKEN in env');
}

export function adminGraphQLEndpoint(): string {
  return `https://${SHOP_DOMAIN}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
}

export function adminRestBase(): string {
  return `https://${SHOP_DOMAIN}/admin/api/${ADMIN_API_VERSION}`;
}

/**
 * Admin GraphQL helper (robust against HTML/non‑JSON responses).
 */
export async function shopifyAdminGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(adminGraphQLEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const raw = await res.text();
  // Try to parse JSON even if content-type is wrong
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`Admin GraphQL HTTP ${res.status}: ${raw.slice(0, 600)}`);
  }

  if (!json || typeof json !== 'object') {
    throw new Error(`Admin GraphQL non-JSON response: ${raw.slice(0, 600)}`);
  }

  const j = json as { data?: T; errors?: unknown; [k: string]: unknown };
  if (j.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(j.errors)}`);
  }

  return (j.data as T) ?? ({} as T);
}

/**
 * Admin REST helper (GET by default).
 */
export async function shopifyAdminREST<T = unknown>(
  pathWithQuery: string,
  init?: RequestInit
): Promise<T> {
  const url = `${adminRestBase()}${pathWithQuery}`;
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  });

  const raw = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`Admin REST HTTP ${res.status}: ${raw.slice(0, 600)}`);
  }

  if (!json || typeof json !== 'object') {
    throw new Error(`Admin REST non-JSON response: ${raw.slice(0, 600)}`);
  }

  return json as T;
}

/**
 * Find a Page by handle → returns Admin GraphQL ID or null.
 * Tries Admin GraphQL (pages(query:)) first; if the server rejects `query`,
 * falls back to Admin REST: GET /pages.json?handle=...
 */
export async function findPageIdByHandle(handle: string): Promise<string | null> {
  // Try Admin GraphQL with search query
  const FIND = /* GraphQL */ `
    query FindPages($q: String!) {
      pages(first: 1, query: $q) {
        edges { node { id handle title } }
      }
    }
  `;

  try {
    const data = await shopifyAdminGraphQL<{
      pages: { edges: Array<{ node: { id: string; handle: string } }> };
    }>(FIND, { q: `handle:${handle}` });

    const node = data.pages?.edges?.[0]?.node;
    if (node?.handle === handle) return node.id;
  } catch (e) {
    const msg = (e as Error).message || '';
    // If this store/version rejects the `query` arg altogether, fall through to REST.
    if (!msg.includes("doesn't accept argument 'query'")) {
      // For other GraphQL errors, rethrow so callers can see them.
      // (If you'd rather always fall back, just comment out the throw.)
      // return null; // alternative: swallow and fall through
      throw e;
    }
  }

  // Fallback: Admin REST exact handle lookup
  try {
    const json = await shopifyAdminREST<{ pages: Array<{ admin_graphql_api_id: string; handle: string }> }>(
      `/pages.json?handle=${encodeURIComponent(handle)}&limit=1`
    );
    const page = json.pages?.[0];
    return page?.admin_graphql_api_id ?? null;
  } catch {
    return null;
  }
}