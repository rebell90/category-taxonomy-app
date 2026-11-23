import prisma from '@/lib/prisma';
import { ok, toolError, type ToolResult } from './types';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ——— preview_archive_category ——————————————————————————————————————————

export async function handlePreviewArchiveCategory(args: {
  id: string;
}): Promise<ToolResult> {
  const cat = await prisma.category.findUnique({
    where: { id: args.id },
    select: { id: true, title: true, slug: true, archivedAt: true },
  });
  if (!cat) return toolError(`Category "${args.id}" not found`);
  if (cat.archivedAt) return toolError(`Category "${cat.title}" is already archived`);

  const [childrenCount, productCount, children] = await Promise.all([
    prisma.category.count({ where: { parentId: args.id, archivedAt: null } }),
    prisma.productCategory.count({ where: { categoryId: args.id } }),
    prisma.category.findMany({
      where: { parentId: args.id, archivedAt: null },
      select: { id: true, title: true, slug: true },
      take: 20,
    }),
  ]);

  // Create single-use token
  const token = await prisma.archiveToken.create({
    data: {
      categoryId: args.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
    select: { id: true, expiresAt: true },
  });

  const blockers: string[] = [];
  if (childrenCount > 0)
    blockers.push(`${childrenCount} active child ${childrenCount === 1 ? 'category' : 'categories'}`);
  if (productCount > 0)
    blockers.push(`${productCount} assigned ${productCount === 1 ? 'product' : 'products'}`);

  return ok({
    categoryId: cat.id,
    title: cat.title,
    slug: cat.slug,
    impact: { childrenCount, productCount, children },
    blocked: blockers.length > 0,
    blockers,
    confirmToken: token.id,
    tokenExpiresAt: token.expiresAt,
    instruction:
      blockers.length > 0
        ? `Cannot archive until blockers are resolved: ${blockers.join(', ')}`
        : 'Call confirm_archive_category with this token within 5 minutes to proceed.',
  });
}

// ——— confirm_archive_category —————————————————————————————————————————

export async function handleConfirmArchiveCategory(args: {
  token: string;
}): Promise<ToolResult> {
  const tokenRow = await prisma.archiveToken.findUnique({
    where: { id: args.token },
    select: { id: true, categoryId: true, expiresAt: true, usedAt: true },
  });
  if (!tokenRow) return toolError('Invalid or unknown token');
  if (tokenRow.usedAt) return toolError('This token has already been used');
  if (tokenRow.expiresAt < new Date()) return toolError('Token has expired — call preview_archive_category again');

  const cat = await prisma.category.findUnique({
    where: { id: tokenRow.categoryId },
    select: { id: true, title: true, slug: true, archivedAt: true },
  });
  if (!cat) return toolError('Category no longer exists');
  if (cat.archivedAt) return toolError(`Category "${cat.title}" is already archived`);

  // Re-check blockers at confirm time (state may have changed since preview)
  const [childrenCount, productCount] = await Promise.all([
    prisma.category.count({ where: { parentId: cat.id, archivedAt: null } }),
    prisma.productCategory.count({ where: { categoryId: cat.id } }),
  ]);

  if (childrenCount > 0)
    return toolError(
      `Cannot archive: ${childrenCount} active child ${childrenCount === 1 ? 'category' : 'categories'} still present. Archive or reassign them first.`,
    );
  if (productCount > 0)
    return toolError(
      `Cannot archive: ${productCount} ${productCount === 1 ? 'product' : 'products'} still assigned. Reassign them first.`,
    );

  await prisma.$transaction([
    prisma.category.update({ where: { id: cat.id }, data: { archivedAt: new Date() } }),
    prisma.archiveToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } }),
  ]);

  return ok({ archived: true, categoryId: cat.id, title: cat.title, slug: cat.slug });
}
