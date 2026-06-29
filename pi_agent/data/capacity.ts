/**
 * 产能分析服务（移植自 ai_service/app/services/analysis_service.py）
 *
 * 公式：
 * - 日产能定额 = 设备台数 × 单台日标准产量
 * - 负荷率 = 待处理订单量 ÷ 日产能定额 × 100%
 * - 超负荷倍数 = 待处理订单量 ÷ 日产能定额
 * - 完工天数 = 待处理订单量 ÷ 日产能定额
 */

export interface BaseCapacity {
  base_name: string;
  location: string;
  machine_count: number;
  per_machine_daily_output: number;
  daily_capacity: number;
  pending_orders: number;
  load_rate: number;
  overload_multiplier: number;
  days_to_complete: number;
}

export interface RecommendationResult {
  recommended_base: string | null;
  reason: string;
  load_rate?: number;
  estimated_days?: number;
}

export interface DeliveryEstimate {
  base_name: string;
  estimated_days: number;
  daily_capacity: number;
  pending_orders: number;
  new_order_quantity: number;
  load_rate: number;
  message: string;
}

export function calculateDailyCapacity(
  machineCount: number,
  perMachineOutput: number,
): number {
  if (machineCount <= 0 || perMachineOutput <= 0) return 0;
  return machineCount * perMachineOutput;
}

export function calculateLoadMetrics(
  pendingOrders: number,
  dailyCapacity: number,
): { load_rate: number; overload_multiplier: number; days_to_complete: number } {
  if (dailyCapacity <= 0) {
    return { load_rate: 0, overload_multiplier: 0, days_to_complete: 0 };
  }
  return {
    load_rate: round1((pendingOrders / dailyCapacity) * 100),
    overload_multiplier: round1(pendingOrders / dailyCapacity),
    days_to_complete: round1(pendingOrders / dailyCapacity),
  };
}

export function analyzeBaseCapacity(args: {
  base_name: string;
  location: string;
  machine_count: number;
  per_machine_daily_output: number;
  pending_orders: number;
}): BaseCapacity {
  const dailyCapacity = calculateDailyCapacity(
    args.machine_count,
    args.per_machine_daily_output,
  );
  const metrics = calculateLoadMetrics(args.pending_orders, dailyCapacity);
  return {
    base_name: args.base_name,
    location: args.location,
    machine_count: args.machine_count,
    per_machine_daily_output: args.per_machine_daily_output,
    daily_capacity: dailyCapacity,
    pending_orders: args.pending_orders,
    ...metrics,
  };
}

export function recommendBase(basesData: BaseCapacity[]): RecommendationResult {
  if (basesData.length === 0) {
    return { recommended_base: null, reason: "没有可用基地数据" };
  }
  const valid = basesData.filter((b) => b.daily_capacity > 0);
  if (valid.length === 0) {
    return { recommended_base: null, reason: "没有有效产能的基地" };
  }
  const best = valid.reduce((min, b) =>
    b.load_rate < min.load_rate ? b : min,
  );
  return {
    recommended_base: best.base_name,
    reason:
      `${best.base_name}当前负荷率最低（${best.load_rate}%），` +
      `日产能${best.daily_capacity}单，待处理${best.pending_orders}单，` +
      `预计${best.days_to_complete}天可完成`,
    load_rate: best.load_rate,
    estimated_days: best.days_to_complete,
  };
}

export function estimateDelivery(args: {
  base_name: string;
  machine_count: number;
  per_machine_daily_output: number;
  pending_orders: number;
  order_quantity?: number;
}): DeliveryEstimate {
  const orderQuantity = args.order_quantity ?? 1;
  const dailyCapacity = calculateDailyCapacity(
    args.machine_count,
    args.per_machine_daily_output,
  );
  if (dailyCapacity <= 0) {
    return {
      base_name: args.base_name,
      estimated_days: -1,
      daily_capacity: 0,
      pending_orders: args.pending_orders,
      new_order_quantity: orderQuantity,
      load_rate: 0,
      message: "该基地无有效产能",
    };
  }
  const totalPending = args.pending_orders + orderQuantity;
  const estimatedDays = round1(totalPending / dailyCapacity);
  const loadRate = round1((args.pending_orders / dailyCapacity) * 100);
  return {
    base_name: args.base_name,
    estimated_days: estimatedDays,
    daily_capacity: dailyCapacity,
    pending_orders: args.pending_orders,
    new_order_quantity: orderQuantity,
    load_rate: loadRate,
    message: `预计在${args.base_name}需要${estimatedDays}天完成`,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
