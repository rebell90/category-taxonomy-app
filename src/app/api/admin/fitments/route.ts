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
    const mod = await import('@/lib/product-metafields').catch(() => null);
    const fn = mod?.writeProductFitmentsMetafield as
      | ((gid: string) => Promise<void>)
      | undefined;
    if (fn) await fn(productGid);
  } catch {
    // ignore
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
  const body = (await req.json()) as CreateBody;

  const productGid = 'productGid' in body ? body.productGid : undefined;
  if (!productGid) {
    return NextResponse.json({ error: 'Missing productGid' }, { status: 400 });
  }

  const yearFrom = toNumOrNull((body as { yearFrom?: number | null }).yearFrom);
  const yearTo = toNumOrNull((body as { yearTo?: number | null }).yearTo);
  const trim = (body as { trim?: string | null }).trim ?? null;
  const chassis = (body as { chassis?: string | null }).chassis ?? null;

  let makeName: string | null = null;
  let modelName: string | null = null;

  // Path A: IDs
  if ('makeId' in body && 'modelId' in body) {
    const makeTerm = await prisma.fitTerm.findUnique({
      where: { id: body.makeId },
      select: { id: true, name: true, type: true },
    });
    if (!makeTerm || makeTerm.type !== 'MAKE') {
      return NextResponse.json({ error: 'Invalid makeId' }, { status: 400 });
    }

    const modelTerm = await prisma.fitTerm.findUnique({
      where: { id: body.modelId },
      select: { id: true, name: true, type: true, parentId: true },
    });
    if (!modelTerm || modelTerm.type !== 'MODEL') {
      return NextResponse.json({ error: 'Invalid modelId' }, { status: 400 });
    }

    if (modelTerm.parentId && modelTerm.parentId !== makeTerm.id) {
      return NextResponse.json({ error: 'modelId not a child of makeId' }, { status: 400 });
    }

    makeName = makeTerm.name;
    modelName = modelTerm.name;
  }

  // Path B: Names
  if (!makeName || !modelName) {
    const { make, model } = body as CreateBodyNames;
    if (!make || !model) {
      return NextResponse.json(
        { error: 'Missing make/model (or makeId/modelId)' },
        { status: 400 }
      );
    }
    const makeTerm = await ensureFitTerm('MAKE', make.trim(), null);
    const modelTerm = await ensureFitTerm('MODEL', model.trim(), makeTerm.id);
    makeName = makeTerm.name;
    modelName = modelTerm.name;
  }

  const created = await prisma.productFitment.upsert({
    where: {
      productGid_make_model_yearFrom_yearTo_trim_chassis: {
        productGid,
        make: makeName!,
        model: modelName!,
        yearFrom,
        yearTo,
        trim,
        chassis,
      },
    },
    create: {
      productGid,
      make: makeName!,
      model: modelName!,
      yearFrom,
      yearTo,
      trim,
      chassis,
    },
    update: {},
  });

  await tryWriteMetafield(productGid);

  return NextResponse.json(created);
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