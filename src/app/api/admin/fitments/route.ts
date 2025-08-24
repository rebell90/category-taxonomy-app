import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

interface CreateBodyIds {
  productGid: string;
  makeId: string;
  modelId: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
}

interface CreateBodyNames {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
}

type CreateBody = CreateBodyIds | CreateBodyNames;

interface DeleteBody {
  id?: string;
  productGid?: string;
  make?: string;
  model?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
}

// -------- Helpers --------
function toNumOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureFitTerm(type: FitTermType, name: string, parentId?: string | null) {
  const existing = await prisma.fitTerm.findFirst({
    where: parentId ? { type, name, parentId } : { type, name },
    select: { id: true, type: true, name: true, parentId: true },
  });
  if (existing) return existing;

  return prisma.fitTerm.create({
    data: { type, name, parentId: parentId ?? undefined },
    select: { id: true, type: true, name: true, parentId: true },
  });
}

async function tryWriteMetafield(productGid: string) {
  try {
    const mod = await import('@/lib/product-metafields');

    // Type-safe picking of whichever function exists
    const maybeA: unknown = (mod as Record<string, unknown>)['writeProductFitmentsMetafield'];
    const maybeB: unknown = (mod as Record<string, unknown>)['rebuildProductFitmentMetafield'];

    const writer =
      (typeof maybeA === 'function' ? (maybeA as (gid: string) => Promise<void>) : undefined) ??
      (typeof maybeB === 'function' ? (maybeB as (gid: string) => Promise<void>) : undefined);

    if (writer) {
      await writer(productGid);
    } else {
      // No-op if neither function exists; keep silent
    }
  } catch {
    // Swallow to avoid breaking API responses if the writer isn’t present
  }
}

// -------- Routes --------
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const productGid = url.searchParams.get('productGid') || undefined;
  const make = url.searchParams.get('make') || undefined;
  const model = url.searchParams.get('model') || undefined;
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : undefined;

  const where: NonNullable<Parameters<typeof prisma.productFitment.findMany>[0]>['where'] = {};

  if (productGid) where.productGid = { equals: productGid };
  if (make) where.make = { equals: make };
  if (model) where.model = { equals: model };
  if (typeof year === 'number' && Number.isFinite(year)) {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
    ];
  }

  const fitments = await prisma.productFitment.findMany({
    where,
    orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
  });

  return NextResponse.json({ fitments });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      productGid: string;
      makeId: string;
      modelId: string;
      trimId?: string | null;
      chassisId?: string | null;
      yearFrom?: number | string | null;
      yearTo?: number | string | null;
    };

    const {
      productGid,
      makeId,
      modelId,
      trimId = null,
      chassisId = null,
      yearFrom,
      yearTo,
    } = body;

    if (!productGid || !makeId || !modelId) {
      return NextResponse.json({ error: 'Missing productGid, makeId, or modelId' }, { status: 400 });
    }

    // Coerce to numbers or null
    const yf: number | null =
      typeof yearFrom === 'number'
        ? yearFrom
        : typeof yearFrom === 'string' && yearFrom.trim()
        ? Number(yearFrom)
        : null;

    const yt: number | null =
      typeof yearTo === 'number'
        ? yearTo
        : typeof yearTo === 'string' && yearTo.trim()
        ? Number(yearTo)
        : null;

    // Resolve names for the term ids you store (adjust if you store ids instead)
    const [makeTerm, modelTerm, trimTerm, chassisTerm] = await Promise.all([
      prisma.fitTerm.findUnique({ where: { id: makeId } }),
      prisma.fitTerm.findUnique({ where: { id: modelId } }),
      trimId ? prisma.fitTerm.findUnique({ where: { id: trimId } }) : Promise.resolve(null),
      chassisId ? prisma.fitTerm.findUnique({ where: { id: chassisId } }) : Promise.resolve(null),
    ]);

    if (!makeTerm || !modelTerm) {
      return NextResponse.json({ error: 'Invalid makeId or modelId' }, { status: 400 });
    }

    const created = await prisma.productFitment.create({
      data: {
        productGid,
        make: makeTerm.name,
        model: modelTerm.name,
        ...(trimTerm ? { trim: trimTerm.name } : {}),
        ...(chassisTerm ? { chassis: chassisTerm.name } : {}),
        ...(yf !== null ? { yearFrom: yf } : {}),
        ...(yt !== null ? { yearTo: yt } : {}),
      },
    });

    // Optionally refresh metafield
    await tryWriteMetafield(productGid);

    return NextResponse.json(created);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as DeleteBody;

  if (body.id) {
    const deleted = await prisma.productFitment.delete({ where: { id: body.id } });
    await tryWriteMetafield(deleted.productGid);
    return NextResponse.json({ success: true });
  }

  const productGid = body.productGid;
  const make = body.make?.trim();
  const model = body.model?.trim();
  if (!productGid || !make || !model) {
    return NextResponse.json(
      { error: 'Missing productGid/make/model (or provide id)' },
      { status: 400 }
    );
  }

  const yearFrom = toNumOrNull(body.yearFrom);
  const yearTo = toNumOrNull(body.yearTo);
  const trim = body.trim ?? null;
  const chassis = body.chassis ?? null;

  const deleted = await prisma.productFitment.delete({
    where: {
      productGid_make_model_yearFrom_yearTo_trim_chassis: {
        productGid,
        make,
        model,
        yearFrom,
        yearTo,
        trim,
        chassis,
      },
    },
  });

  await tryWriteMetafield(productGid);
  return NextResponse.json({ success: true });
}