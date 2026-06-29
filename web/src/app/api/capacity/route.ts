import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const bases = await prisma.base.findMany({
      where: { active: true },
      include: { snapshots: { orderBy: { snapshotDate: "desc" }, take: 1 } },
    });

    const result = bases.map((base) => {
      const snapshot = base.snapshots[0];
      const dailyCapacity = base.machineCount * base.perMachineDailyOutput;
      const pendingOrders = snapshot?.pendingOrders ?? 0;
      const loadRate = dailyCapacity > 0 ? Math.round((pendingOrders / dailyCapacity) * 100 * 10) / 10 : 0;
      const overloadMultiplier = dailyCapacity > 0 ? Math.round((pendingOrders / dailyCapacity) * 10) / 10 : 0;
      const daysToComplete = dailyCapacity > 0 ? Math.round((pendingOrders / dailyCapacity) * 10) / 10 : 0;

      return {
        base_name: base.name,
        location: base.location,
        machine_count: base.machineCount,
        per_machine_daily_output: base.perMachineDailyOutput,
        daily_capacity: dailyCapacity,
        pending_orders: pendingOrders,
        load_rate: loadRate,
        overload_multiplier: overloadMultiplier,
        days_to_complete: daysToComplete,
      };
    });

    return NextResponse.json({ bases: result });
  } catch (error) {
    console.error("Capacity API error:", error);
    return NextResponse.json({
      fallback: true,
      bases: [
        { base_name: "广州基地", location: "广州", daily_capacity: 96, pending_orders: 35, load_rate: 36.5, overload_multiplier: 0.4, days_to_complete: 0.4 },
        { base_name: "上海基地", location: "上海", daily_capacity: 100, pending_orders: 22, load_rate: 22.0, overload_multiplier: 0.2, days_to_complete: 0.2 },
        { base_name: "成都基地", location: "成都", daily_capacity: 105, pending_orders: 15, load_rate: 14.3, overload_multiplier: 0.1, days_to_complete: 0.1 },
        { base_name: "武汉基地", location: "武汉", daily_capacity: 81, pending_orders: 28, load_rate: 34.6, overload_multiplier: 0.3, days_to_complete: 0.3 },
        { base_name: "天津基地", location: "天津", daily_capacity: 48, pending_orders: 48, load_rate: 100.0, overload_multiplier: 1.0, days_to_complete: 1.0 },
      ],
    });
  }
}
