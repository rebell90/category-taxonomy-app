import prisma from '@/lib/prisma';

export async function getSlugsForProduct(productGid: string): Promise<string[]> {
  const links = await prisma.productCategory.findMany({
    where: { productGid },
    select: { categoryId: true },
  });

  const slugs = new Set<string>();

  for (const { categoryId } of links) {
    let current = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, slug: true, parentId: true },
    });

    while (current) {
      if (current.slug) slugs.add(current.slug);
      current = current.parentId
        ? await prisma.category.findUnique({
            where: { id: current.parentId },
            select: { id: true, slug: true, parentId: true },
          })
        : null;
    }
  }

  return Array.from(slugs);
}