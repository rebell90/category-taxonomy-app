import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { rebuildProductCategoryMetafield } from '@/lib/product-metafields';

export async function POST(req: NextRequest) {
  const { productGid, categoryId } = await req.json();
  if (!productGid || !categoryId) return NextResponse.json({ error: 'Missing productGid or categoryId' }, { status: 400 });

  const link = await prisma.productCategory.upsert({
    where: { productGid_categoryId: { productGid, categoryId } },
    create: { productGid, categoryId },
    update: {},
  });

  await rebuildProductCategoryMetafield(productGid);
  return NextResponse.json(link);
}

export async function DELETE(req: NextRequest) {
  const { productGid, categoryId } = await req.json();
  if (!productGid || !categoryId) return NextResponse.json({ error: 'Missing productGid or categoryId' }, { status: 400 });

  await prisma.productCategory.delete({
    where: { productGid_categoryId: { productGid, categoryId } },
  });

  await rebuildProductCategoryMetafield(productGid);
  return NextResponse.json({ success: true });
}