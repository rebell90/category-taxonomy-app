import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing handlers
vi.mock('@/lib/prisma', () => ({
  default: {
    category: {
      findMany: vi.fn(),
    },
    fitTerm: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    productCategory: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    productFitment: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/product-metafields', () => ({
  rebuildProductCategoryMetafield: vi.fn().mockResolvedValue(undefined),
  rebuildProductFitmentMetafield: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '@/lib/prisma';
import { handleSetProductCategories, handleSetProductFitment } from '@/lib/mcp/tools-assign';

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleSetProductCategories', () => {
  it('returns error for unknown category IDs', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    const result = await handleSetProductCategories({
      productGid: 'gid://shopify/Product/123',
      categoryIds: ['cat-does-not-exist'],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown category IDs');
  });

  it('returns error for archived categories', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      { id: 'cat-1', archivedAt: new Date() },
    ]);

    const result = await handleSetProductCategories({
      productGid: 'gid://shopify/Product/123',
      categoryIds: ['cat-1'],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('archived');
  });

  it('returns dry_run preview without writing', async () => {
    mockPrisma.category.findMany
      .mockResolvedValueOnce([{ id: 'cat-1', archivedAt: null }]) // validateCategoryIds
      .mockResolvedValueOnce([]) // existing
      .mockResolvedValueOnce([{ id: 'cat-1', slug: 'parts', title: 'Parts' }]); // toAdd lookup

    mockPrisma.productCategory.findMany.mockResolvedValue([]);

    const result = await handleSetProductCategories({
      productGid: 'gid://shopify/Product/123',
      categoryIds: ['cat-1'],
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.dry_run).toBe(true);
    expect(mockPrisma.productCategory.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.productCategory.createMany).not.toHaveBeenCalled();
  });

  it('replaces existing assignments on replace=true (default)', async () => {
    mockPrisma.category.findMany.mockResolvedValue([{ id: 'cat-new', archivedAt: null }]);
    mockPrisma.productCategory.findMany.mockResolvedValue([{ categoryId: 'cat-old' }]);
    mockPrisma.productCategory.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.productCategory.createMany.mockResolvedValue({ count: 1 });

    const result = await handleSetProductCategories({
      productGid: 'gid://shopify/Product/123',
      categoryIds: ['cat-new'],
      replace: true,
    });

    expect(result.isError).toBeFalsy();
    expect(mockPrisma.productCategory.deleteMany).toHaveBeenCalledWith({
      where: { productGid: 'gid://shopify/Product/123' },
    });
    expect(mockPrisma.productCategory.createMany).toHaveBeenCalled();
  });

  it('normalizes numeric product GID', async () => {
    mockPrisma.category.findMany.mockResolvedValue([{ id: 'cat-1', archivedAt: null }]);
    mockPrisma.productCategory.findMany.mockResolvedValue([]);
    mockPrisma.productCategory.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.productCategory.createMany.mockResolvedValue({ count: 1 });

    const result = await handleSetProductCategories({
      productGid: '123456',
      categoryIds: ['cat-1'],
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.productGid).toBe('gid://shopify/Product/123456');
  });
});

describe('handleSetProductFitment', () => {
  it('allows empty fitments with replace=true (clears all)', async () => {
    mockPrisma.productFitment.findMany.mockResolvedValue([{ id: 'fit-1', make: 'make-x', model: 'model-x' }]);
    mockPrisma.productFitment.deleteMany.mockResolvedValue({ count: 1 });

    const result = await handleSetProductFitment({
      productGid: 'gid://shopify/Product/123',
      fitments: [],
      replace: true,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.added).toBe(0);
    expect(data.removed).toBe(1);
  });

  it('returns error when fitments array is empty with replace=false', async () => {
    const result = await handleSetProductFitment({
      productGid: 'gid://shopify/Product/123',
      fitments: [],
      replace: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cannot be empty when replace=false');
  });

  it('returns error when makeId is not found', async () => {
    mockPrisma.fitTerm.findMany.mockResolvedValue([]);

    const result = await handleSetProductFitment({
      productGid: 'gid://shopify/Product/123',
      fitments: [{ makeId: 'make-x', modelId: 'model-x' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('makeId');
  });

  it('returns error when modelId does not belong to makeId', async () => {
    mockPrisma.fitTerm.findMany.mockResolvedValue([
      { id: 'make-1', type: 'MAKE', parentId: null },
      { id: 'model-1', type: 'MODEL', parentId: 'make-OTHER' }, // wrong parent
    ]);

    const result = await handleSetProductFitment({
      productGid: 'gid://shopify/Product/123',
      fitments: [{ makeId: 'make-1', modelId: 'model-1' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('does not belong to makeId');
  });

  it('returns error when yearFrom > yearTo', async () => {
    mockPrisma.fitTerm.findMany.mockResolvedValue([
      { id: 'make-1', type: 'MAKE', parentId: null },
      { id: 'model-1', type: 'MODEL', parentId: 'make-1' },
    ]);

    const result = await handleSetProductFitment({
      productGid: 'gid://shopify/Product/123',
      fitments: [{ makeId: 'make-1', modelId: 'model-1', yearFrom: 2020, yearTo: 2015 }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('yearFrom');
  });

  it('writes fitment and returns ok on valid input', async () => {
    mockPrisma.fitTerm.findMany.mockResolvedValue([
      { id: 'make-1', type: 'MAKE', parentId: null },
      { id: 'model-1', type: 'MODEL', parentId: 'make-1' },
    ]);
    mockPrisma.productFitment.findMany.mockResolvedValue([]);
    mockPrisma.productFitment.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.productFitment.createMany.mockResolvedValue({ count: 1 });

    const result = await handleSetProductFitment({
      productGid: 'gid://shopify/Product/123',
      fitments: [{ makeId: 'make-1', modelId: 'model-1', yearFrom: 2015, yearTo: 2020 }],
    });

    expect(result.isError).toBeFalsy();
    expect(mockPrisma.productFitment.createMany).toHaveBeenCalled();
    const data = JSON.parse(result.content[0].text);
    expect(data.added).toBe(1);
  });
});
