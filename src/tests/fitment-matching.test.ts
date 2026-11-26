/**
 * Tests for ID+name OR matching in the fitment filter endpoints.
 * Uses the shared buildFitmentWhere logic exported for testing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock prisma ─────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  default: {
    fitTerm: { findMany: vi.fn() },
    productFitment: { findMany: vi.fn() },
    productCategory: { findMany: vi.fn() },
    category: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/shopify', () => ({
  shopifyAdminGraphQL: vi.fn().mockResolvedValue({ nodes: [] }),
}));

import prisma from '@/lib/prisma';

type MockPrisma = {
  fitTerm: { findMany: ReturnType<typeof vi.fn> };
  productFitment: { findMany: ReturnType<typeof vi.fn> };
  productCategory: { findMany: ReturnType<typeof vi.fn> };
  category: { findFirst: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};
const mock = prisma as unknown as MockPrisma;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(params: Record<string, string>) {
  const url = new URL('https://app.test/api/public/products-by-slug-v2');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function fitmentReq(params: Record<string, string>) {
  const url = new URL('https://app.test/api/public/fitment-filter');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

// ─── products-by-slug-v2 tests ───────────────────────────────────────────────

describe('products-by-slug-v2 fitment matching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all category products when no vehicle params given', async () => {
    const { GET } = await import('@/app/api/public/products-by-slug-v2/route');

    mock.category.findFirst.mockResolvedValue({ id: 'cat-1' });
    mock.productCategory.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);
    mock.$queryRaw.mockResolvedValue([{ exists: false }]); // skip fitment table

    const res = await GET(makeReq({ slug: 'coilovers' }) as never);
    expect(res.status).toBe(200);
    // shopify returns no nodes but no error
    const json = await res.json();
    expect(json.products).toBeDefined();
  });

  it('matches by FitTerm ID (new rows)', async () => {
    const { GET } = await import('@/app/api/public/products-by-slug-v2/route');

    mock.category.findFirst.mockResolvedValue({ id: 'cat-1' });
    mock.productCategory.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);
    mock.$queryRaw.mockResolvedValue([{ exists: true }]);
    mock.fitTerm.findMany.mockResolvedValue([
      { id: 'make-id-1', name: 'Toyota' },
      { id: 'model-id-1', name: 'GR Corolla' },
    ]);
    // Fitment row stored with IDs — should be found
    mock.productFitment.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);

    const res = await GET(makeReq({ slug: 'coilovers', make_id: 'make-id-1', model_id: 'model-id-1' }) as never);
    expect(res.status).toBe(200);

    // Verify the WHERE that was passed includes the ID
    const call = mock.productFitment.findMany.mock.calls[0][0];
    const makeClause = JSON.stringify(call.where);
    expect(makeClause).toContain('make-id-1');
  });

  it('falls back to name matching and logs warning', async () => {
    const { GET } = await import('@/app/api/public/products-by-slug-v2/route');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mock.category.findFirst.mockResolvedValue({ id: 'cat-1' });
    mock.productCategory.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);
    mock.$queryRaw.mockResolvedValue([{ exists: true }]);
    mock.fitTerm.findMany.mockResolvedValue([]); // no IDs to resolve
    mock.productFitment.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);

    const res = await GET(makeReq({ slug: 'coilovers', make: 'Toyota', model: 'GR Corolla' }) as never);
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('name-based vehicle filter'),
      expect.any(String),
      expect.any(Object),
    );

    // WHERE should include the name
    const call = mock.productFitment.findMany.mock.calls[0][0];
    expect(JSON.stringify(call.where)).toContain('Toyota');
    warnSpy.mockRestore();
  });

  it('includes chassis=null rows when chassisId is provided (fits-all)', async () => {
    const { GET } = await import('@/app/api/public/products-by-slug-v2/route');

    mock.category.findFirst.mockResolvedValue({ id: 'cat-1' });
    mock.productCategory.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);
    mock.$queryRaw.mockResolvedValue([{ exists: true }]);
    mock.fitTerm.findMany.mockResolvedValue([
      { id: 'make-id-1', name: 'Toyota' },
      { id: 'model-id-1', name: 'GR Corolla' },
      { id: 'chassis-id-1', name: 'GZEA10' },
    ]);
    mock.productFitment.findMany.mockResolvedValue([]);

    await GET(makeReq({ slug: 'coilovers', make_id: 'make-id-1', model_id: 'model-id-1', chassis_id: 'chassis-id-1' }) as never);

    const call = mock.productFitment.findMany.mock.calls[0][0];
    const whereStr = JSON.stringify(call.where);
    // Must include chassis: null clause to match "fits all" rows
    expect(whereStr).toContain('"chassis":null');
    // Must also include the specific chassis ID
    expect(whereStr).toContain('chassis-id-1');
  });

  it('returns empty array when category not found', async () => {
    const { GET } = await import('@/app/api/public/products-by-slug-v2/route');
    mock.category.findFirst.mockResolvedValue(null);

    const res = await GET(makeReq({ slug: 'nonexistent' }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products).toEqual([]);
  });

  it('returns empty array when no fitments match selected vehicle', async () => {
    const { GET } = await import('@/app/api/public/products-by-slug-v2/route');

    mock.category.findFirst.mockResolvedValue({ id: 'cat-1' });
    mock.productCategory.findMany.mockResolvedValue([
      { productGid: 'gid://shopify/Product/1' },
    ]);
    mock.$queryRaw.mockResolvedValue([{ exists: true }]);
    mock.fitTerm.findMany.mockResolvedValue([{ id: 'make-id-1', name: 'Acura' }]);
    mock.productFitment.findMany.mockResolvedValue([]); // no matches

    const res = await GET(makeReq({ slug: 'coilovers', make_id: 'make-id-1' }) as never);
    const json = await res.json();
    expect(json.products).toEqual([]);
  });
});

// ─── fitment-filter tests ────────────────────────────────────────────────────

describe('fitment-filter matching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all productGids when no vehicle params given', async () => {
    const { GET } = await import('@/app/api/public/fitment-filter/route');

    mock.fitTerm.findMany.mockResolvedValue([]);

    const res = await GET(fitmentReq({ productGids: 'gid://shopify/Product/1,gid://shopify/Product/2' }) as never);
    const json = await res.json();
    expect(json.allowedProductGids).toHaveLength(2);
  });

  it('matches ID-stored rows via makeId', async () => {
    const { GET } = await import('@/app/api/public/fitment-filter/route');

    mock.fitTerm.findMany.mockResolvedValue([{ id: 'make-id-1', name: 'Mazda' }]);
    mock.productFitment.findMany.mockResolvedValue([{ productGid: 'gid://shopify/Product/1' }]);

    const res = await GET(fitmentReq({
      productGids: 'gid://shopify/Product/1',
      makeId: 'make-id-1',
    }) as never);

    const json = await res.json();
    expect(json.allowedProductGids).toContain('gid://shopify/Product/1');

    const call = mock.productFitment.findMany.mock.calls[0][0];
    expect(JSON.stringify(call.where)).toContain('make-id-1');
  });

  it('also matches name-stored rows via resolved name fallback', async () => {
    const { GET } = await import('@/app/api/public/fitment-filter/route');

    mock.fitTerm.findMany.mockResolvedValue([{ id: 'make-id-1', name: 'Mazda' }]);
    mock.productFitment.findMany.mockResolvedValue([{ productGid: 'gid://shopify/Product/1' }]);

    await GET(fitmentReq({
      productGids: 'gid://shopify/Product/1',
      makeId: 'make-id-1',
    }) as never);

    // WHERE must include resolved name "Mazda" for old name-based rows
    const call = mock.productFitment.findMany.mock.calls[0][0];
    expect(JSON.stringify(call.where)).toContain('Mazda');
  });

  it('includes chassis=null rows when chassisId provided', async () => {
    const { GET } = await import('@/app/api/public/fitment-filter/route');

    mock.fitTerm.findMany.mockResolvedValue([
      { id: 'chassis-id-1', name: 'NA' },
    ]);
    mock.productFitment.findMany.mockResolvedValue([]);

    await GET(fitmentReq({
      productGids: 'gid://shopify/Product/1',
      chassisId: 'chassis-id-1',
    }) as never);

    const call = mock.productFitment.findMany.mock.calls[0][0];
    const whereStr = JSON.stringify(call.where);
    expect(whereStr).toContain('"chassis":null');
  });

  it('returns empty array when no productGids provided', async () => {
    const { GET } = await import('@/app/api/public/fitment-filter/route');
    mock.fitTerm.findMany.mockResolvedValue([]);

    const res = await GET(fitmentReq({}) as never);
    const json = await res.json();
    expect(json.allowedProductGids).toEqual([]);
  });
});
