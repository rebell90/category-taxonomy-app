// src/app/api/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

/**
 * GET /api/fitments
 * Optional query params:
 *  - productGid (string)
 *  - make (string, contains/insensitive)
 *  - model (string, contains/insensitive)
 *  - year (number, inclusive range test with yearFrom/yearTo)
 *
 * Example:
 *  /api/fitments?make=Honda&model=Civic&year=2019
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const productGid = searchParams.get('productGid') || undefined
    const make = searchParams.get('make') || undefined
    const model = searchParams.get('model') || undefined
    const yearParam = searchParams.get('year')
    const year = yearParam ? Number(yearParam) : undefined

    const where: Prisma.ProductFitmentWhereInput = {}

    if (productGid) where.productGid = productGid
    if (make) where.make = { contains: make, mode: 'insensitive' }
    if (model) where.model = { contains: model, mode: 'insensitive' }

    if (typeof year === 'number' && !Number.isNaN(year)) {
      // Include if (yearFrom is null or <= year) AND (yearTo is null or >= year)
      where.AND = [
        { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
        { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
      ]
    }

    const fitments = await prisma.productFitment.findMany({
      where,
      orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
    })

    return NextResponse.json(fitments, { headers: corsHeaders })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Public fitments GET error:', message)
    return NextResponse.json({ error: 'Failed to fetch fitments' }, { status: 500, headers: corsHeaders })
  }
}