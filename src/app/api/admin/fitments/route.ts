// src/app/api/fitments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ✅ Define a DTO (data transfer object) type for incoming payloads
interface FitmentPayload {
  productGid: string
  yearFrom?: number
  yearTo?: number
  make: string
  model: string
  trim?: string
  chassis?: string
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

    const newFitment = await prisma.productFitment.create({
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

    return NextResponse.json(newFitment)
  } catch (err) {
    console.error('Error creating fitment:', err)
    return NextResponse.json({ error: 'Failed to create fitment' }, { status: 500 })
  }
}