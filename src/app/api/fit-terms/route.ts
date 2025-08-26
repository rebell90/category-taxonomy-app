// src/app/api/fit-terms/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type FitType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

type TermRow = {
  id: string;
  type: FitType;
  name: string;
  parentId: string | null;
};

function buildTree(rows: TermRow[], parentId: string | null): (TermRow & { children?: TermRow[] })[] {
  return rows
    .filter((r) => r.parentId === parentId)
    .map((r) => ({ ...r, children: buildTree(rows, r.id) }));
}

/** ---------------- GET: list terms (tree or flat) ---------------- */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const flat = url.searchParams.get('flat') === '1';

    const rows = (await prisma.fitTerm.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, type: true, name: true, parentId: true },
    })) as TermRow[];

    if (flat) {
      return NextResponse.json(rows, { headers: corsHeaders });
    }

    const tree = buildTree(rows, null);
    return NextResponse.json({ rows, tree }, { headers: corsHeaders });
  } catch (e) {
    console.error('[fit-terms] GET failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
  }
}

/** ---------------- Helpers & validation ---------------- */
function normalizeType(t: unknown): FitType | null {
  if (typeof t !== 'string') return null;
  const u = t.toUpperCase();
  return u === 'MAKE' || u === 'MODEL' || u === 'TRIM' || u === 'CHASSIS' ? (u as FitType) : null;
}

async function assertParentAllowed(childType: FitType, parentId: string | null) {
  if (!parentId) {
    if (childType === 'MAKE') return; // MAKE is top-level
    // MODEL, TRIM, CHASSIS require a parent
    throw new Error(`${childType} requires a parent`);
  }

  const parent = await prisma.fitTerm.findUnique({
    where: { id: parentId },
    select: { id: true, type: true },
  });

  if (!parent) throw new Error('Parent not found');

  if (childType === 'MODEL' && parent.type !== 'MAKE') {
    throw new Error('MODEL must have a MAKE as parent');
  }
  if (childType === 'TRIM' && parent.type !== 'MODEL') {
    throw new Error('TRIM must have a MODEL as parent');
  }
  if (childType === 'CHASSIS' && !(parent.type === 'MAKE' || parent.type === 'MODEL')) {
    throw new Error('CHASSIS must have a MAKE or MODEL as parent');
  }
}

/** ---------------- POST: create a term ---------------- */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      type?: unknown;
      name?: unknown;
      parentId?: unknown;
    };

    const type = normalizeType(body.type);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const parentId =
      body.parentId === null || body.parentId === undefined
        ? null
        : typeof body.parentId === 'string'
        ? body.parentId
        : null;

    if (!type) return NextResponse.json({ error: 'Invalid type' }, { status: 400, headers: corsHeaders });
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400, headers: corsHeaders });

    await assertParentAllowed(type, parentId);

    const created = await prisma.fitTerm.create({
      data: { type, name, parentId },
      select: { id: true, type: true, name: true, parentId: true },
    });

    return NextResponse.json(created, { status: 201, headers: corsHeaders });
  } catch (e) {
    console.error('[fit-terms] POST failed', e);
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 400, headers: corsHeaders });
  }
}

/** ---------------- PUT: update a term (name/parent) ---------------- */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: unknown;
      name?: unknown;
      parentId?: unknown;
    };

    const id = typeof body.id === 'string' ? body.id : '';
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const parentId =
      body.parentId === undefined
        ? undefined // means don't change parent
        : body.parentId === null
        ? null
        : typeof body.parentId === 'string'
        ? body.parentId
        : undefined;

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: corsHeaders });

    const current = await prisma.fitTerm.findUnique({
      where: { id },
      select: { id: true, type: true, parentId: true },
    });
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });

    if (parentId !== undefined) {
      await assertParentAllowed(current.type as FitType, parentId);
    }

    const updated = await prisma.fitTerm.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      },
      select: { id: true, type: true, name: true, parentId: true },
    });

    return NextResponse.json(updated, { headers: corsHeaders });
  } catch (e) {
    console.error('[fit-terms] PUT failed', e);
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 400, headers: corsHeaders });
  }
}

/** ---------------- DELETE: delete a term (no children) ---------------- */
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: corsHeaders });

    const child = await prisma.fitTerm.findFirst({
      where: { parentId: id },
      select: { id: true },
    });
    if (child) {
      return NextResponse.json(
        { error: 'Cannot delete a term that still has children. Remove children first.' },
        { status: 400, headers: corsHeaders }
      );
    }

    await prisma.fitTerm.delete({ where: { id } });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (e) {
    console.error('[fit-terms] DELETE failed', e);
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 400, headers: corsHeaders });
  }
}