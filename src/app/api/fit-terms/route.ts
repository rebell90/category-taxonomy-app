import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

type FitTermRow = {
  id: string;
  type: FitTermType;
  name: string;
  parentId: string | null;
};

type FitTermNode = FitTermRow & { children: FitTermNode[] };

function buildTree(rows: FitTermRow[], parentId: string | null): FitTermNode[] {
  return rows
    .filter(r => r.parentId === parentId)
    .map(r => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

// GET: list as a tree (grouped), with optional ?type=MAKE|MODEL|TRIM|CHASSIS
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type') as FitTermType | null;

  const rows = await prisma.fitTerm.findMany({
    where: typeParam ? { type: typeParam } : undefined,
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    select: { id: true, type: true, name: true, parentId: true },
  });

  // Return both: flat and tree by convenience
  const tree = buildTree(rows, null);

  return NextResponse.json({ rows, tree });
}

// POST: create a term
// body: { type: 'MODEL', name: 'Civic', parentId?: '...' }
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    type?: FitTermType;
    name?: string;
    parentId?: string | null;
  };

  const type = body.type;
  const name = (body.name || '').trim();
  const parentId = body.parentId ?? null;

  if (!type || !name) {
    return NextResponse.json({ error: 'type and name are required' }, { status: 400 });
  }

  // Basic parent rules:
  // MODEL requires parent MAKE
  // TRIM  requires parent MODEL
  // CHASSIS can be standalone (or you may enforce parent if you want)
  if (type === 'MODEL' && !parentId) {
    return NextResponse.json({ error: 'MODEL requires a parent MAKE' }, { status: 400 });
  }
  if (type === 'TRIM' && !parentId) {
    return NextResponse.json({ error: 'TRIM requires a parent MODEL' }, { status: 400 });
  }

  if (parentId) {
    const parent = await prisma.fitTerm.findUnique({ where: { id: parentId } });
    if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 400 });
    if (type === 'MODEL' && parent.type !== 'MAKE') {
      return NextResponse.json({ error: 'MODEL parent must be a MAKE' }, { status: 400 });
    }
    if (type === 'TRIM' && parent.type !== 'MODEL') {
      return NextResponse.json({ error: 'TRIM parent must be a MODEL' }, { status: 400 });
    }
  }

  const created = await prisma.fitTerm.create({
    data: { type, name, parentId },
    select: { id: true, type: true, name: true, parentId: true },
  });

  return NextResponse.json(created);
}

// PUT: update a term
// body: { id, name?, parentId? }
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    id?: string;
    name?: string;
    parentId?: string | null;
  };
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // optional validations if parent changes
  if (typeof body.parentId !== 'undefined' && body.parentId) {
    const child = await prisma.fitTerm.findUnique({ where: { id: body.id } });
    const parent = await prisma.fitTerm.findUnique({ where: { id: body.parentId } });
    if (!child || !parent) {
      return NextResponse.json({ error: 'Invalid child or parent' }, { status: 400 });
    }
    if (child.type === 'MODEL' && parent.type !== 'MAKE') {
      return NextResponse.json({ error: 'MODEL parent must be a MAKE' }, { status: 400 });
    }
    if (child.type === 'TRIM' && parent.type !== 'MODEL') {
      return NextResponse.json({ error: 'TRIM parent must be a MODEL' }, { status: 400 });
    }
  }

  const updated = await prisma.fitTerm.update({
    where: { id: body.id },
    data: {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      parentId: typeof body.parentId !== 'undefined' ? body.parentId : undefined,
    },
    select: { id: true, type: true, name: true, parentId: true },
  });

  return NextResponse.json(updated);
}

// DELETE: remove a term (will cascade fail if children exist)
export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // Safety: prevent deleting a node with children
  const kids = await prisma.fitTerm.count({ where: { parentId: body.id } });
  if (kids > 0) {
    return NextResponse.json({ error: 'Delete or reparent children first' }, { status: 400 });
  }

  await prisma.fitTerm.delete({ where: { id: body.id } });
  return NextResponse.json({ success: true });
}