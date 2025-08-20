// src/app/api/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Payload the client sends when creating a fitment
interface FitmentPayload {
  productGid: string
  yearFrom?: number | null
  yearTo?: number | null
  make: string
  model: string
  trim?: string | null
  chassis?: string | null
}

export async function GET() {
  try {
    const fitments = await prisma.productFitment.findMany({
      orderBy: [{ make: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
    })
    return NextResponse.json(fitments)
  } catch (err) {
    console.error('Error fetching fitments:', err)
    return NextResponse.json({ error: 'Failed to fetch fitments' }, { status: 500 })
  }
}

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
  } catch (err) {
    console.error('Error creating fitment:', err)
    return NextResponse.json({ error: 'Failed to create fitment' }, { status: 500 })
  }
}

/**
 * Optional: delete by id (handy for your UI)
 * DELETE /api/fitments?id=<fitmentId>
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
  } catch (err) {
    console.error('Error deleting fitment:', err)
    return NextResponse.json({ error: 'Failed to delete fitment' }, { status: 500 })
  }
}