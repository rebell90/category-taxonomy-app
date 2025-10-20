/ src/app/api/admin/distributors/map-category/route.ts
// Map a distributor category to your taxonomy

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      distributorCategoryId: string;
      categoryId: string | null;
    };

    const updated = await prisma.distributorCategory.update({
      where: { id: body.distributorCategoryId },
      data: { categoryId: body.categoryId },
      include: {
        distributor: true,
        category: true,
      },
    });

    return NextResponse.json({
      success: true,
      mapping: updated,
    });
  } catch (error) {
    console.error('Map category error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}