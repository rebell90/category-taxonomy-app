/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/shopify.ts
const SHOP = process.env.SHOPIFY_SHOP;           // e.g. "mrjmdj-wq"
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;   // Admin API token from the merchant store custom app

if (!SHOP || !TOKEN) {
  console.warn('⚠️ Missing SHOPIFY_SHOP or SHOPIFY_ADMIN_TOKEN in .env');
}

export async function shopifyAdminGraphQL<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const url = `https://${SHOP}.myshopify.com/admin/api/2024-07/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });

  // Be robust if Shopify returns HTML (login/redirect) or non-JSON
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  let json: any = null;
  if (contentType.includes('application/json')) {
    try { json = JSON.parse(raw); } catch { /* fall through */ }
  }

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  if (!json) {
    throw new Error(`Shopify returned non-JSON: ${raw.slice(0, 500)}`);
  }
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const userErrors = json.data?.metafieldsSet?.userErrors;
  if (userErrors && userErrors.length) {
    throw new Error(`metafieldsSet userErrors: ${JSON.stringify(userErrors)}`);
  }

  return json.data as T;
}