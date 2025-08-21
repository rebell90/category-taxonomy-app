// src/app/api/admin/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productGid = searchParams.get('productGid') || undefined
  const make = searchParams.get('make') || undefined
  const model = searchParams.get('model') || undefined
  const year = searchParams.get('year')
  const yearNum = year ? Number(year) : undefined

  const where: Prisma.ProductFitmentWhereInput = {}

  if (productGid) where.productGid = productGid
  if (make) where.make = make
  if (model) where.model = model
  if (yearNum && Number.isFinite(yearNum)) {
    where.AND = [
      { OR: [{ yearFrom: null }, { yearFrom: { lte: yearNum } }] },
      { OR: [{ yearTo: null }, { yearTo: { gte: yearNum } }] },
    ]
  }

  const fitments = await prisma.productFitment.findMany({
    where,
    orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
  })

  return NextResponse.json({ fitments })
}

type PostBody = {
  productGid: string
  make: string
  model: string
  yearFrom?: number | null
  yearTo?: number | null
  trim?: string | null
  chassis?: string | null
}

/**
 * Create or update a fitment uniquely identified by
 * (productGid, make, model, yearFrom, yearTo, trim, chassis).
 * We avoid `upsert` on the compound unique to dodge TS nullability friction.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody

  const productGid = body.productGid?.trim()
  const make = body.make?.trim()
  const model = body.model?.trim()
  if (!productGid || !make || !model) {
    return NextResponse.json(
      { error: 'productGid, make, and model are required' },
      { status: 400 }
    )
  }

  const yearFrom: number | null =
    typeof body.yearFrom === 'number' && Number.isFinite(body.yearFrom)
      ? body.yearFrom
      : null
  const yearTo: number | null =
    typeof body.yearTo === 'number' && Number.isFinite(body.yearTo)
      ? body.yearTo
      : null
  const trim: string | null = body.trim?.trim() ? body.trim.trim() : null
  const chassis: string | null = body.chassis?.trim() ? body.chassis.trim() : null

  // Find a matching row (treat nulls as exact matches)
  const existing = await prisma.productFitment.findFirst({
    where: {
      productGid,
      make,
      model,
      yearFrom,
      yearTo,
      trim,
      chassis,
    },
  })

  if (existing) {
    const updated = await prisma.productFitment.update({
      where: { id: existing.id },
      data: {
        // updateable fields — if you add more columns later, include them here
        yearFrom,
        yearTo,
        trim,
        chassis,
      },
    })
    return NextResponse.json(updated)
  }

  const created = await prisma.productFitment.create({
    data: { productGid, make, model, yearFrom, yearTo, trim, chassis },
  })
  return NextResponse.json(created)
}

type DeleteBody = { id: string }

export async function DELETE(req: NextRequest) {
  const { id } = (await req.json()) as DeleteBody
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.productFitment.delete({ where: { id } })
  return NextResponse.json({ success: true })
}