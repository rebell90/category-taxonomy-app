import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import type { ProductFitment } from '@prisma/client'

/** Build a strongly-typed Prisma where clause from query params */
function buildWhere(searchParams: URLSearchParams) {
  const make  = searchParams.get('make')  || undefined
  const model = searchParams.get('model') || undefined
  const yearParam = searchParams.get('year')
  const year = yearParam ? Number(yearParam) : undefined
  const productGid = searchParams.get('productGid') || undefined

  const where: Parameters<typeof prisma.productFitment.findMany>[0]['where'] = {}

  if (productGid) where.productGid = { equals: productGid }
  if (make)       where.make       = { equals: make }
  if (model)      where.model      = { equals: model }
  if (year) {
    where.AND = [
      { yearFrom: { lte: year } },
      { yearTo:   { gte: year } },
    ]
  }

  return where
}

/** GET /api/admin/fitments?make=&model=&year=&productGid=&page=&pageSize= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 25)))
    const skip     = (page - 1) * pageSize
    const take     = pageSize

    const where = buildWhere(searchParams)

    const [items, total] = await Promise.all([
      prisma.productFitment.findMany({
        where,
        orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
        skip,
        take,
      }),
      prisma.productFitment.count({ where }),
    ])

    return NextResponse.json({
      items,
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    console.error('GET /api/admin/fitments error:', err)
    return NextResponse.json({ error: 'Failed to fetch fitments' }, { status: 500 })
  }
}

/** Basic shape for POST/PUT bodies (no `any`) */
type FitmentUpsertInput = {
  productGid: string
  make: string
  model: string
  yearFrom?: number | null
  yearTo?: number | null
  trim?: string | null
  chassis?: string | null
}

/** POST /api/admin/fitments  (create) */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FitmentUpsertInput

    if (!body.productGid || !body.make || !body.model) {
      return NextResponse.json({ error: 'productGid, make, and model are required' }, { status: 400 })
    }

    const yearFrom = body.yearFrom ?? null
    const yearTo   = body.yearTo   ?? null
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
      return NextResponse.json({ error: 'yearFrom cannot be greater than yearTo' }, { status: 400 })
    }

    const created = await prisma.productFitment.create({
      data: {
        productGid: body.productGid,
        make: body.make,
        model: body.model,
        yearFrom,
        yearTo,
        trim: body.trim ?? null,
        chassis: body.chassis ?? null,
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error('POST /api/admin/fitments error:', err)
    return NextResponse.json({ error: 'Failed to create fitment' }, { status: 500 })
  }
}

/** PUT /api/admin/fitments  (update by id) */
export async function PUT(req: NextRequest) {
  try {
    const { id, ...rest } = (await req.json()) as Partial<ProductFitment> & { id?: string }
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const data: Partial<ProductFitment> = {}
    if (typeof rest.productGid === 'string') data.productGid = rest.productGid
    if (typeof rest.make === 'string')       data.make       = rest.make
    if (typeof rest.model === 'string')      data.model      = rest.model
    if (typeof rest.yearFrom === 'number' || rest.yearFrom === null) data.yearFrom = rest.yearFrom ?? null
    if (typeof rest.yearTo === 'number'   || rest.yearTo === null)   data.yearTo   = rest.yearTo ?? null
    if (typeof rest.trim === 'string'     || rest.trim === null)     data.trim     = rest.trim ?? null
    if (typeof rest.chassis === 'string'  || rest.chassis === null)  data.chassis  = rest.chassis ?? null

    if (data.yearFrom != null && data.yearTo != null && data.yearFrom > data.yearTo) {
      return NextResponse.json({ error: 'yearFrom cannot be greater than yearTo' }, { status: 400 })
    }

    const updated = await prisma.productFitment.update({
      where: { id },
      data,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('PUT /api/admin/fitments error:', err)
    return NextResponse.json({ error: 'Failed to update fitment' }, { status: 500 })
  }
}

/** DELETE /api/admin/fitments  (delete by id) */
export async function DELETE(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: string }
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    await prisma.productFitment.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/admin/fitments error:', err)
    return NextResponse.json({ error: 'Failed to delete fitment' }, { status: 500 })
  }
}