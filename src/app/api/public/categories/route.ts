// src/app/api/public/categories/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

type Row = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
};

type PublicNode = Row & {
  image: string | null;        // keep keys for frontend; always null for now
  description: string | null;  // keep keys for frontend; always null for now
  children: PublicNode[];
};

function buildTree(rows: PublicNode[], parentId: string | null): PublicNode[] {
  return rows
    .filter(r => r.parentId === parentId)
    .map(r => ({ ...r, children: buildTree(rows, r.id) }));
}

export async function GET() {
  try {
    // IMPORTANT: raw SQL selecting ONLY existing columns.
    // Double quotes preserve exact column names as created by Prisma.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT "id", "title", "slug", "parentId"
      FROM "Category"
      ORDER BY COALESCE("parentId", ''), "title"
    `;

    const flat: PublicNode[] = rows.map(r => ({
      ...r,
      image: null,
      description: null,
      children: [],
    }));

    const tree = buildTree(flat, null);
    return NextResponse.json(tree, { headers: corsHeaders });
  } catch (err) {
    console.error('/api/public/categories error', err);
    return NextResponse.json(
      { error: 'Failed to load categories' },
      { status: 500, headers: corsHeaders }
    );
  }
}