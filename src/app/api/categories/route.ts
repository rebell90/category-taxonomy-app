// src/app/api/public/categories/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// CORS (this endpoint is fetched from your theme)
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

type PublicNode = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  image: string | null;        // always present in payload, may be null
  description: string | null;  // always present in payload, may be null
  children: PublicNode[];
};

function buildTree(rows: PublicNode[], parentId: string | null): PublicNode[] {
  return rows
    .filter(r => r.parentId === parentId)
    .map(r => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

export async function GET() {
  try {
    // IMPORTANT: do NOT select image/description here (DB may not have columns yet)
    const rows = await prisma.category.findMany({
      orderBy: [{ title: 'asc' }],
      select: { id: true, title: true, slug: true, parentId: true },
    });

    // normalize payload to always include image/description keys
    const flat: PublicNode[] = (rows as Row[]).map(r => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      parentId: r.parentId,
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
      { status: 500, headers: corsHeaders },
    );
  }
}