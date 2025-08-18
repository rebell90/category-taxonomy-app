import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET() {
  try {
    const [catCount, linkCount, topCats] = await Promise.all([
      prisma.category.count(),
      prisma.productCategory.count(),
      prisma.category.findMany({ where: { parentId: null }, select: { id: true, title: true, slug: true } }),
    ])

    // Mask most of the URL; just show host so we can tell prod vs local.
    const url = process.env.DATABASE_URL || ''
    let dbHost = ''
    try {
      const u = new URL(url.replace('prisma://', 'http://'))
      dbHost = `${u.hostname}:${u.port || ''}`
    } catch { /* ignore */ }

    return NextResponse.json({
      dbHost,
      catCount,
      productCategoryLinks: linkCount,
      topLevelSample: topCats.slice(0, 10),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}