import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ProductFitment } from "@prisma/client";

// GET /api/fitments?year=2020&make=Toyota&model=Camry
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const year = searchParams.get("year")
      ? Number(searchParams.get("year"))
      : undefined;
    const make = searchParams.get("make") || undefined;
    const model = searchParams.get("model") || undefined;

    // Build Prisma filter with proper typing
    const where: Parameters<typeof prisma.productFitment.findMany>[0]["where"] = {};

    if (make) {
      where.make = { equals: make };
    }
    if (model) {
      where.model = { equals: model };
    }
    if (year) {
      where.AND = [
        { yearFrom: { lte: year } },
        { yearTo: { gte: year } },
      ];
    }

    const fitments: ProductFitment[] = await prisma.productFitment.findMany({
      where,
      orderBy: [{ make: "asc" }, { model: "asc" }],
    });

    return NextResponse.json(fitments);
  } catch (err) {
    console.error("Error in GET /api/fitments:", err);
    return NextResponse.json(
      { error: "Failed to fetch fitments" },
      { status: 500 }
    );
  }
}

// POST /api/fitments
export async function POST(req: Request) {
  try {
    const body: ProductFitment = await req.json();

    const newFitment = await prisma.productFitment.create({
      data: {
        productGid: body.productGid,
        make: body.make,
        model: body.model,
        yearFrom: body.yearFrom,
        yearTo: body.yearTo,
        trim: body.trim,
        chassis: body.chassis,
      },
    });

    return NextResponse.json(newFitment, { status: 201 });
  } catch (err) {
    console.error("Error in POST /api/fitments:", err);
    return NextResponse.json(
      { error: "Failed to create fitment" },
      { status: 500 }
    );
  }
}