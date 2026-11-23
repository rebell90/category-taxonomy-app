import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    category: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    productCategory: {
      count: vi.fn(),
    },
    archiveToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '@/lib/prisma';
import { handlePreviewArchiveCategory, handleConfirmArchiveCategory } from '@/lib/mcp/tools-archive';

type MockPrisma = {
  category: Record<string, ReturnType<typeof vi.fn>>;
  productCategory: Record<string, ReturnType<typeof vi.fn>>;
  archiveToken: Record<string, ReturnType<typeof vi.fn>>;
  $transaction: ReturnType<typeof vi.fn>;
};
const mockPrisma = prisma as unknown as MockPrisma;

beforeEach(() => {
  vi.resetAllMocks();
});

const FUTURE = new Date(Date.now() + 10 * 60 * 1000);
const PAST = new Date(Date.now() - 10 * 60 * 1000);

describe('handlePreviewArchiveCategory', () => {
  it('returns error when category not found', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const result = await handlePreviewArchiveCategory({ id: 'cat-404' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('returns error when category already archived', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', title: 'Old Cat', slug: 'old-cat', archivedAt: new Date(),
    });

    const result = await handlePreviewArchiveCategory({ id: 'cat-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already archived');
  });

  it('returns blocked=true with blockers when children exist', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', title: 'Parent', slug: 'parent', archivedAt: null,
    });
    mockPrisma.category.count.mockResolvedValue(3);
    mockPrisma.productCategory.count.mockResolvedValue(0);
    mockPrisma.category.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.archiveToken.create.mockResolvedValue({ id: 'tok-1', expiresAt: FUTURE });

    const result = await handlePreviewArchiveCategory({ id: 'cat-1' });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.blocked).toBe(true);
    expect(data.blockers).toContain('3 active child categories');
  });

  it('returns blocked=false and confirmToken when clear', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', title: 'Leaf', slug: 'leaf', archivedAt: null,
    });
    mockPrisma.category.count.mockResolvedValue(0);
    mockPrisma.productCategory.count.mockResolvedValue(0);
    mockPrisma.category.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.archiveToken.create.mockResolvedValue({ id: 'tok-abc', expiresAt: FUTURE });

    const result = await handlePreviewArchiveCategory({ id: 'cat-1' });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.blocked).toBe(false);
    expect(data.confirmToken).toBe('tok-abc');
  });
});

describe('handleConfirmArchiveCategory', () => {
  it('returns error for unknown token', async () => {
    mockPrisma.archiveToken.findUnique.mockResolvedValue(null);

    const result = await handleConfirmArchiveCategory({ token: 'bad-token' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid or unknown token');
  });

  it('returns error for already-used token', async () => {
    mockPrisma.archiveToken.findUnique.mockResolvedValue({
      id: 'tok-1', categoryId: 'cat-1', expiresAt: FUTURE, usedAt: new Date(),
    });

    const result = await handleConfirmArchiveCategory({ token: 'tok-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already been used');
  });

  it('returns error for expired token', async () => {
    mockPrisma.archiveToken.findUnique.mockResolvedValue({
      id: 'tok-1', categoryId: 'cat-1', expiresAt: PAST, usedAt: null,
    });

    const result = await handleConfirmArchiveCategory({ token: 'tok-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('expired');
  });

  it('re-checks blockers at confirm time and blocks if children appeared', async () => {
    mockPrisma.archiveToken.findUnique.mockResolvedValue({
      id: 'tok-1', categoryId: 'cat-1', expiresAt: FUTURE, usedAt: null,
    });
    mockPrisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', title: 'Cat', slug: 'cat', archivedAt: null,
    });
    mockPrisma.category.count.mockResolvedValue(2); // children appeared since preview
    mockPrisma.productCategory.count.mockResolvedValue(0);

    const result = await handleConfirmArchiveCategory({ token: 'tok-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('active child');
  });

  it('archives category and marks token used on success', async () => {
    mockPrisma.archiveToken.findUnique.mockResolvedValue({
      id: 'tok-1', categoryId: 'cat-1', expiresAt: FUTURE, usedAt: null,
    });
    mockPrisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', title: 'Cat', slug: 'cat', archivedAt: null,
    });
    mockPrisma.category.count.mockResolvedValue(0);
    mockPrisma.productCategory.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    const result = await handleConfirmArchiveCategory({ token: 'tok-1' });

    expect(result.isError).toBeFalsy();
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    const data = JSON.parse(result.content[0].text);
    expect(data.archived).toBe(true);
    expect(data.categoryId).toBe('cat-1');
  });
});
