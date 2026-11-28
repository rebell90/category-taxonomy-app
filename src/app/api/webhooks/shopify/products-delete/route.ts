import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';

function verifyHmac(body: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const hmac = req.headers.get('x-shopify-hmac-sha256');

  if (!verifyHmac(body, hmac)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: { id?: number | string; admin_graphql_api_id?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const productGid =
    payload.admin_graphql_api_id ??
    (payload.id ? `gid://shopify/Product/${payload.id}` : null);

  if (!productGid) {
    return NextResponse.json({ error: 'Missing product ID' }, { status: 400 });
  }

  await Promise.all([
    prisma.productCategory.deleteMany({ where: { productGid } }),
    prisma.productFitment.deleteMany({ where: { productGid } }),
  ]);

  console.log(`[webhook:products/delete] Cleaned up ${productGid}`);
  return NextResponse.json({ ok: true });
}
