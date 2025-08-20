// src/app/api/fitments/route.ts
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const make = searchParams.get("make");
  const model = searchParams.get("model");
  const year = searchParams.get("year") ? Number(searchParams.get("year")) : undefined;

  const where: any = {};
  if (make) where.make = make;
  if (model) where.model = model;
  if (year) {
    where.AND = [
      { yearFrom: { lte: year } },
      { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
    ];
  }

  const fitments = await prisma.productFitment.findMany({ where });
  return NextResponse.json(fitments);
}