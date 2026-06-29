import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const bases = await prisma.base.findMany({
      orderBy: { name: "asc" },
    });
    return NextResponse.json(bases);
  } catch (error) {
    console.error("Error fetching bases:", error);
    return NextResponse.json({ error: "Failed to fetch bases" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base = await prisma.base.create({
      data: {
        name: body.name,
        location: body.location,
        machineCount: body.machineCount,
        perMachineDailyOutput: body.perMachineDailyOutput,
        active: body.active ?? true,
      },
    });
    return NextResponse.json(base, { status: 201 });
  } catch (error) {
    console.error("Error creating base:", error);
    return NextResponse.json({ error: "Failed to create base" }, { status: 500 });
  }
}
