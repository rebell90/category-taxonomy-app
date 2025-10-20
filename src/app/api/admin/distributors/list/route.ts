// src/app/api/admin/distributors/list/route.ts
// List all distributor products and categories

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const distributorCode = searchParams.get('distributor') || 'vivid-racing';
    const type = searchParams.get('type') || 'products'; // 'products' or 'categories'

    const distributor = await prisma.distributor.findUnique({
      where: { code: distributorCode },
    });

    if (!distributor) {
      return NextResponse.json(
        { error: 'Distributor not found' },
        { status: 404 }
      );
    }

    if (type === 'categories') {
      const categories = await prisma.distributorCategory.findMany({
        where: { distributorId: distributor.id },
        include: {
          category: {
            select: {
              id: true,
              title: true,
              slug: true,
            },
          },
        },
        orderBy: { distributorName: 'asc' },
      });

      return NextResponse.json({ categories });
    }

    // Default: list products
    const imported = searchParams.get('imported');
    const products = await prisma.distributorProduct.findMany({
      where: {
        distributorId: distributor.id,
        ...(imported === 'true' ? { shopifyProductGid: { not: null } } : {}),
        ...(imported === 'false' ? { shopifyProductGid: null } : {}),
      },
      orderBy: { lastScrapedAt: 'desc' },
      take: 100, // Limit for performance
    });

    return NextResponse.json({ products });
  } catch (error) {
    console.error('List error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}