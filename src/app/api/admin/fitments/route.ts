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

  // Use Prisma’s type directly
  const where: Prisma.ProductFitmentWhereInput = {}

  if (productGid) where.productGid = productGid
  if (make) where.make = make
  if (model) where.model = model
  if (yearNum && Number.isFinite(yearNum)) {
    // overlap: (yearFrom IS NULL OR yearFrom <= year) AND (yearTo IS NULL OR yearTo >= year)
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

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody
  const { productGid, make, model } = body

  if (!productGid || !make?.trim() || !model?.trim()) {
    return NextResponse.json({ error: 'productGid, make, and model are required' }, { status: 400 })
  }

  // Normalize numbers / empties
  const yearFrom = body.yearFrom ?? null
  const yearTo = body.yearTo ?? null
  const trim = body.trim?.trim() ? body.trim : null
  const chassis = body.chassis?.trim() ? body.chassis : null

  const saved = await prisma.productFitment.upsert({
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
    create: { productGid, make, model, yearFrom, yearTo, trim, chassis },
    update: { productGid, make, model, yearFrom, yearTo, trim, chassis },
  })

  return NextResponse.json(saved)
}

type DeleteBody = { id: string }

export async function DELETE(req: NextRequest) {
  const { id } = (await req.json()) as DeleteBody
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.productFitment.delete({ where: { id } })
  return NextResponse.json({ success: true })
}