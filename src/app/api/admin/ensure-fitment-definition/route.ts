import { NextRequest, NextResponse } from 'next/server';
import { shopifyAdminGraphQL } from '@/lib/shopify';

const SECRET = process.env.BACKFILL_SECRET;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!SECRET || secret !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Create the metafield definition if missing
  const MUT = `
    mutation Ensure($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id name namespace key type }
        userErrors { field message }
      }
    }
  `;

  // Product metafield: namespace "fitment", key "ymm", type "json"
  const definition = {
    name: "Fitment (YMM JSON)",
    namespace: "fitment",
    key: "ymm",
    ownerType: "PRODUCT",
    type: "json",
    description: "Year/Make/Model (optional Trim/Chassis) entries for storefront filtering.",
    visibleToStorefrontApi: true
  };

  try {
    const data = await shopifyAdminGraphQL<{
      metafieldDefinitionCreate: {
        createdDefinition?: { id: string };
        userErrors?: Array<{ field?: string[]; message: string }>;
      }
    }>(MUT, { definition });

    const errs = data.metafieldDefinitionCreate?.userErrors || [];
    // If it already exists, Shopify returns an error like "key already taken" — that’s fine.
    const ok = data.metafieldDefinitionCreate?.createdDefinition?.id || errs.length > 0;
    return NextResponse.json({ ok: Boolean(ok), userErrors: errs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}