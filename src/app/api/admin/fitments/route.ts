import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// ---- Types you likely already have in Prisma ----
// model FitTerm {
//   id        String   @id @default(cuid())
//   type      String   // 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS'
//   name      String
//   parentId  String?
//   createdAt DateTime @default(now())
//   updatedAt DateTime @updatedAt
//   @@index([type, name])
// }

// model ProductFitment {
//   id         String   @id @default(cuid())
//   productGid String
//   make       String
//   model      String
//   yearFrom   Int?
//   yearTo     Int?
//   trim       String?
//   chassis    String?
//   createdAt  DateTime @default(now())
//   updatedAt  DateTime @updatedAt
//   @@index([productGid])
//   @@index([make, model])
//   @@index([yearFrom, yearTo])
//   @@unique([productGid, make, model, yearFrom, yearTo, trim, chassis])
// }

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

type CreateBody =
  | {
      // Using IDs route
      productGid: string;
      makeId: string;
      modelId: string;
      yearFrom?: number | null;
      yearTo?: number | null;
      trim?: string | null;
      chassis?: string | null;
    }
  | {
      // Using names route
      productGid: string;
      make: string;
      model: string;
      yearFrom?: number | null;
      yearTo?: number | null;
      trim?: string | null;
      chassis?: string | null;
    };

type DeleteBody = {
  id?: string; // ProductFitment id
  productGid?: string;
  make?: string;
  model?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

// Helper: safely coerce optional numeric strings to number|null
function toNumOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Helper: case-insensitive name match
async function findFitTermByName(type: FitTermType, name: string, parentId?: string | null) {
  const where = parentId
    ? { type, name, parentId: parentId ?? undefined }
    : { type, name };

  return prisma.fitTerm.findFirst({
    where,
    select: { id: true, type: true, name: true, parentId: true },
  });
}

async function ensureFitTerm(type: FitTermType, name: string, parentId?: string | null) {
  const existing = await findFitTermByName(type, name, parentId ?? undefined);
  if (existing) return existing;

  // Create if missing
  return prisma.fitTerm.create({
    data: { type, name, parentId: parentId ?? undefined },
    select: { id: true, type: true, name: true, parentId: true },
  });
}

// Optional metafield writer: dynamically import if you have it
async function tryWriteMetafield(productGid: string) {
  try {
    // You can export writeProductFitmentsMetafield(productGid: string)
    // from '@/lib/product-metafields'
    const mod = await import('@/lib/product-metafields').catch(() => null);
    const fn = (mod && (mod as any).writeProductFitmentsMetafield) as
      | ((gid: string) => Promise<void>)
      | undefined;
    if (fn) {
      await fn(productGid);
    }
  } catch {
    // ignore silently
  }
}

/** ------------------------------------
 * GET /api/admin/fitments
 * Optional query: productGid, make, model, year
 * ------------------------------------ */
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
    // Overlap logic: yearFrom <= year <= yearTo (null bounds allowed)
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

/** ------------------------------------
 * POST /api/admin/fitments
 * Accepts either:
 *  - { productGid, makeId, modelId, ... }
 *  - { productGid, make, model, ... }
 * Creates missing FitTerms when using names.
 * ------------------------------------ */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateBody;

  const productGid = (body as any).productGid as string | undefined;
  if (!productGid) {
    return NextResponse.json({ error: 'Missing productGid' }, { status: 400 });
  }

  // Coerce numeric bounds
  const yearFrom = toNumOrNull((body as any).yearFrom);
  const yearTo = toNumOrNull((body as any).yearTo);
  const trim = ((body as any).trim ?? null) as string | null;
  const chassis = ((body as any).chassis ?? null) as string | null;

  let makeName: string | null = null;
  let modelName: string | null = null;

  // Path A: IDs provided
  if ('makeId' in body && 'modelId' in body && body.makeId && body.modelId) {
    // Confirm they exist, retrieve names
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

    // (Optional) ensure model is under the make
    if (modelTerm.parentId && modelTerm.parentId !== makeTerm.id) {
      return NextResponse.json({ error: 'modelId is not a child of makeId' }, { status: 400 });
    }

    makeName = makeTerm.name;
    modelName = modelTerm.name;
  }

  // Path B: Names provided
  if (!makeName || !modelName) {
    const make = (body as any).make as string | undefined;
    const model = (body as any).model as string | undefined;
    if (!make || !model) {
      return NextResponse.json({ error: 'Missing make/model (or makeId/modelId)' }, { status: 400 });
    }

    // ensure/lookup MAKE
    const makeTerm = await ensureFitTerm('MAKE', make.trim(), null);
    // ensure/lookup MODEL under that MAKE
    const modelTerm = await ensureFitTerm('MODEL', model.trim(), makeTerm.id);

    makeName = makeTerm.name;
    modelName = modelTerm.name;
  }

  // Upsert ProductFitment (unique composite)
  const created = await prisma.productFitment.upsert({
    where: {
      productGid_make_model_yearFrom_yearTo_trim_chassis: {
        productGid,
        make: makeName!,
        model: modelName!,
        yearFrom: yearFrom ?? null,
        yearTo: yearTo ?? null,
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

  // Write metafield (best-effort)
  await tryWriteMetafield(productGid);

  return NextResponse.json(created);
}

/** ------------------------------------
 * DELETE /api/admin/fitments
 * Accepts either:
 *   - { id }  (ProductFitment id)
 *   - { productGid, make, model, yearFrom?, yearTo?, trim?, chassis? } (composite)
 * ------------------------------------ */
export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as DeleteBody;

  // Delete by id if provided
  if (body.id) {
    const deleted = await prisma.productFitment.delete({ where: { id: body.id } });
    await tryWriteMetafield(deleted.productGid);
    return NextResponse.json({ success: true });
  }

  // Otherwise require the composite keys
  const productGid = body.productGid;
  const make = body.make?.trim();
  const model = body.model?.trim();
  if (!productGid || !make || !model) {
    return NextResponse.json(
      { error: 'Missing productGid/make/model (or provide id)' },
      { status: 400 }
    );
  }

  const yearFrom = toNumOrNull(body.yearFrom ?? null);
  const yearTo = toNumOrNull(body.yearTo ?? null);
  const trim = (body.trim ?? null) as string | null;
  const chassis = (body.chassis ?? null) as string | null;

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