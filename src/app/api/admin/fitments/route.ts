import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

interface FitmentPayload {
  productGid: string
  yearFrom?: number | null
  yearTo?: number | null
  make: string
  model: string
  trim?: string | null
  chassis?: string | null
}

/**
 * GET /api/admin/fitments
 * Optional query params: productGid, make, model, year
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const productGid = searchParams.get('productGid') || undefined
    const make = searchParams.get('make') || undefined
    const model = searchParams.get('model') || undefined
    const yearParam = searchParams.get('year')
    const year = yearParam ? Number(yearParam) : undefined

    // ✅ Use Prisma’s generated type for where
    const where: Prisma.ProductFitmentWhereInput = {}

    if (productGid) where.productGid = productGid
    if (make) where.make = { contains: make, mode: 'insensitive' }
    if (model) where.model = { contains: model, mode: 'insensitive' }

    if (typeof year === 'number' && !Number.isNaN(year)) {
      // Include records where:
      // (yearFrom is null OR yearFrom <= year) AND (yearTo is null OR yearTo >= year)
      where.AND = [
        {
          OR: [
            { yearFrom: null },
            { yearFrom: { lte: year } },
          ],
        },
        {
          OR: [
            { yearTo: null },
            { yearTo: { gte: year } },
          ],
        },
      ]
    }

    const fitments = await prisma.productFitment.findMany({
      where,
      orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
    })

    return NextResponse.json(fitments)
  } catch (err: unknown) {
    if (err instanceof Error) console.error('Error fetching fitments:', err.message)
    return NextResponse.json({ error: 'Failed to fetch fitments' }, { status: 500 })
  }
}

/**
 * POST /api/admin/fitments
 * Body: FitmentPayload
 */
export async function POST(req: NextRequest) {
  try {
    const body: FitmentPayload = await req.json()

    if (!body.productGid || !body.make || !body.model) {
      return NextResponse.json(
        { error: 'productGid, make, and model are required' },
        { status: 400 }
      )
    }

    const created = await prisma.productFitment.create({
      data: {
        productGid: body.productGid,
        yearFrom: body.yearFrom ?? null,
        yearTo: body.yearTo ?? null,
        make: body.make,
        model: body.model,
        trim: body.trim ?? null,
        chassis: body.chassis ?? null,
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof Error) console.error('Error creating fitment:', err.message)
    return NextResponse.json({ error: 'Failed to create fitment' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/fitments?id=<fitmentId>
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    await prisma.productFitment.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    if (err instanceof Error) console.error('Error deleting fitment:', err.message)
    return NextResponse.json({ error: 'Failed to delete fitment' }, { status: 500 })
  }
}