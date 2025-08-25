// src/app/api/fit-terms/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

type TermRow = {
  id: string;
  type: 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';
  name: string;
  parentId: string | null;
};

function buildTree(rows: TermRow[], parentId: string | null): (TermRow & { children?: TermRow[] })[] {
  return rows
    .filter(r => r.parentId === parentId)
    .map(r => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const flat = url.searchParams.get('flat') === '1';

    const rows = await prisma.fitTerm.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, type: true, name: true, parentId: true },
    }) as TermRow[];

    if (flat) {
      return NextResponse.json(rows, { headers: cors });
    }

    const tree = buildTree(rows, null);
    return NextResponse.json({ rows, tree }, { headers: cors });
  } catch (e) {
    console.error('[fit-terms] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: cors });
  }
}