import { NextResponse } from "next/server";
import { fetchAllDashboardOrders, type DashboardOrder } from "@/lib/sqlServer";
import { prisma } from "@/lib/prisma";

// ── 工序定义 ──

const PROCESS_STAGES: Record<string, string[]> = {
  "广州中试": ["开单", "排产", "色粉计量", "混料", "挤出", "注塑色板", "注塑样条", "最终完成"],
  "上海中试": ["排产", "色粉计量", "混料", "挤出", "注塑色板", "注塑样条", "最终完成"],
  "小试":     ["排产", "色粉计量", "混料", "挤出", "注塑样条", "最终完成"],
  "OA辅助单":  ["排产", "注塑样条", "最终完成"],
};

function getProcessStages(dataSource: string): string[] {
  return PROCESS_STAGES[dataSource] || PROCESS_STAGES["小试"];
}

function getStageTime(order: DashboardOrder, stageName: string): string | null {
  switch (stageName) {
    case "开单": return order.createOrderTime;
    case "排产": return order.schedulingTime;
    case "色粉计量": return order.colorPowderMeasureTime;
    case "混料": return order.mixingTime;
    case "挤出": return order.extrusionTime;
    case "注塑色板": return order.injectionColorPlateTime;
    case "注塑样条": return order.injectionStripTime;
    case "最终完成": return order.finalCompleteTime;
    default: return null;
  }
}

// ── 状态判断 ──
// 规则：有最终完成时间 = 已完成；否则 = 生产中（订单在系统里就是生产中的某个阶段）
// OA辅助单以 injection_strip_time 作为完成标志

function isCompleted(order: DashboardOrder): boolean {
  if (order.dataSource === "OA辅助单") {
    return order.injectionStripTime !== null;
  }
  return order.finalCompleteTime !== null;
}

// 当前工序 = 最后一个已完成工序的下一道
function determineCurrentStage(order: DashboardOrder): string | null {
  if (isCompleted(order)) return "最终完成";
  const stages = getProcessStages(order.dataSource);
  // 从后往前找最后一个有真实时间（已完成的工序）
  for (let i = stages.length - 2; i >= 0; i--) {
    if (getStageTime(order, stages[i])) {
      return stages[i + 1]; // 下一道就是当前所在工序
    }
  }
  // 没有任何工序有时间 → 在第一个工序
  return stages[0];
}

// 交期估算
function determineDeliveryDate(order: DashboardOrder): string | null {
  if (order.finalCompleteTime) return order.finalCompleteTime;
  if (order.injectionStripTime && order.dataSource === "OA辅助单") return order.injectionStripTime;
  if (order.schedulingTime) {
    const d = new Date(order.schedulingTime);
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  if (order.createOrderTime) {
    const d = new Date(order.createOrderTime);
    d.setDate(d.getDate() + 10);
    return d.toISOString();
  }
  return null;
}

// ── GET /api/dashboard ──

export async function GET() {
  let orders: DashboardOrder[] = [];
  let usingRealData = false;

  try {
    orders = await fetchAllDashboardOrders(30);
    usingRealData = orders.length > 0;
    console.log(`[dashboard] SQL Server: ${orders.length} orders`);
  } catch (err) {
    console.warn("[dashboard] SQL Server unavailable:", err instanceof Error ? err.message : err);
  }

  // Fallback to Prisma seed data
  if (!usingRealData) {
    const bases = await prisma.base.findMany({
      where: { active: true },
      include: { orders: { include: { stages: { orderBy: { sortOrder: "asc" } } } } },
    });
    for (const base of bases) {
      for (const o of base.orders) {
        orders.push({
          orderNo: o.orderNumber, dataSource: base.dataSource, baseName: base.name,
          machine: o.machine, orderCount: o.orderCount,
          extrusionException: o.extrusionException, injectionStripException: o.injectionStripException,
          injectionColorPlateException: o.injectionColorPlateException,
          createOrderTime: null, schedulingTime: null, colorPowderMeasureTime: null,
          mixingTime: null, extrusionTime: null, injectionColorPlateTime: null,
          injectionStripTime: null,
          finalCompleteTime: o.status === "completed" ? o.deliveryDate.toISOString() : null,
          creator: null, schedulingPerson: null, colorPowderMeasurer: null,
          mixingPerson: null, extrusionPerson: null, injectionColorPlatePerson: null,
          injectionStripPerson: null, finalMonitor: null,
        });
      }
    }
  }

  const now = new Date();
  const warningThreshold = new Date(now.getTime() + 2 * 86400000);

  // ── 按 baseName + dataSource 分组（广州中试 / 广州小试 分开） ──
  const groupMap = new Map<string, {
    name: string;
    displayName: string;
    dataSource: string;
    orders: DashboardOrder[];
  }>();

  for (const o of orders) {
    const key = `${o.baseName}|${o.dataSource}`;
    if (!groupMap.has(key)) {
      const displayName = o.dataSource === "广州中试" ? "广州基地(中试)"
        : o.dataSource === "上海中试" ? "上海基地(中试)"
        : o.dataSource === "小试" ? `${o.baseName}(小试)`
        : `${o.baseName}(${o.dataSource})`;
      groupMap.set(key, { name: o.baseName, displayName, dataSource: o.dataSource, orders: [] });
    }
    groupMap.get(key)!.orders.push(o);
  }

  const baseData = Array.from(groupMap.values()).map((group) => {
    const baseOrders = group.orders;
    const ds = group.dataSource;
    const totalOrders = baseOrders.length;

    let inProgressCount = 0, completedCount = 0;
    for (const o of baseOrders) {
      if (isCompleted(o)) completedCount++;
      else inProgressCount++;
    }

    const activeOrders = baseOrders.filter((o) => !isCompleted(o));
    const overdueOrders = activeOrders.filter((o) => {
      const dd = determineDeliveryDate(o);
      return dd && new Date(dd) < now;
    });
    const warningOrders = activeOrders.filter((o) => {
      const dd = determineDeliveryDate(o);
      return dd && new Date(dd) >= now && new Date(dd) <= warningThreshold;
    });

    const extrusionEx = baseOrders.filter((o) => o.extrusionException).length;
    const stripEx = baseOrders.filter((o) => o.injectionStripException).length;
    const colorEx = baseOrders.filter((o) => o.injectionColorPlateException).length;

    // 工序分布：统计每个订单当前所在工序
    const stageOrder = getProcessStages(ds);
    const stageMap = new Map<string, number>();
    for (const o of baseOrders) {
      const cs = determineCurrentStage(o);
      if (cs) stageMap.set(cs, (stageMap.get(cs) || 0) + 1);
    }
    const processDistribution = stageOrder.map((name) => ({
      stageName: name,
      count: stageMap.get(name) || 0,
    }));

    const hasProcessData = ds === "广州中试" || ds === "上海中试" || ds === "小试";

    // Top 5 活跃订单（未完成的，按交期排序）
    const recentOrders = activeOrders
      .sort((a, b) => {
        const da = determineDeliveryDate(a);
        const db = determineDeliveryDate(b);
        if (!da) return 1;
        if (!db) return -1;
        return new Date(da).getTime() - new Date(db).getTime();
      })
      .slice(0, 5)
      .map((o) => ({
        orderNo: o.orderNo,
        productName: "",
        customerName: "",
        machine: o.machine,
        orderCount: o.orderCount,
        status: isCompleted(o) ? "completed" as const : "in_progress" as const,
        priority: "normal",
        plannedDate: determineDeliveryDate(o) || "",
        currentStage: determineCurrentStage(o),
        extrusionException: o.extrusionException,
        injectionStripException: o.injectionStripException,
        injectionColorPlateException: o.injectionColorPlateException,
      }));

    return {
      id: `${group.name}|${ds}`,
      name: group.displayName,
      location: "",
      dataSource: ds,
      orderCount: totalOrders,
      pendingCount: 0,
      inProgressCount,
      completedCount,
      loadRate: 0, dailyCapacity: 0, pendingOrders: 0,
      overloadMultiplier: 0, daysToComplete: 0,
      urgentCount: 0,
      overdueCount: overdueOrders.length,
      warningCount: warningOrders.length,
      extrusionExceptions: extrusionEx,
      injectionStripExceptions: stripEx,
      injectionColorPlateExceptions: colorEx,
      hasProcessData,
      processDistribution,
      recentOrders,
    };
  });

  // ── Global summary ──
  const summary = {
    totalOrders: orders.length,
    pendingCount: 0,
    inProgressCount: baseData.reduce((s, b) => s + b.inProgressCount, 0),
    completedCount: baseData.reduce((s, b) => s + b.completedCount, 0),
    overdueCount: baseData.reduce((s, b) => s + b.overdueCount, 0),
    warningCount: baseData.reduce((s, b) => s + b.warningCount, 0),
    totalExtrusionExceptions: baseData.reduce((s, b) => s + b.extrusionExceptions, 0),
    totalStripExceptions: baseData.reduce((s, b) => s + b.injectionStripExceptions, 0),
    totalColorPlateExceptions: baseData.reduce((s, b) => s + b.injectionColorPlateExceptions, 0),
  };

  // ── Global warnings ──
  const allWarnings = orders
    .filter((o) => {
      if (isCompleted(o)) return false;
      const dd = determineDeliveryDate(o);
      return dd && new Date(dd) < warningThreshold;
    })
    .map((o) => {
      const dd = determineDeliveryDate(o)!;
      return {
        orderNo: o.orderNo, productName: "", baseName: o.baseName,
        plannedDate: dd,
        daysOverdue: Math.round((now.getTime() - new Date(dd).getTime()) / 86400000),
        status: isCompleted(o) ? "completed" as const : "in_progress" as const,
        currentStage: determineCurrentStage(o), machine: o.machine,
        extrusionException: o.extrusionException,
        injectionStripException: o.injectionStripException,
        injectionColorPlateException: o.injectionColorPlateException,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 10);

  return NextResponse.json({ usingRealData, summary, bases: baseData, warnings: allWarnings });
}
