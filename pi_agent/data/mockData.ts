/**
 * Mock 业务数据（移植自 ai_service/app/adapters/mock_adapter.py）
 *
 * 真实部署时替换为从业务数据库/ERP 读取的实现。
 */

export interface OrderStage {
  stage: string;
  status: string;
  date: string;
  operator: string;
}

export interface Order {
  order_no: string;
  product_name: string;
  customer: string;
  current_stage: string;
  stage_status: string;
  planned_date: string | null;
  assignee: string | null;
  base_name: string | null;
  notes: string | null;
  stages: OrderStage[];
}

/** 标准生产工序 */
export const PRODUCTION_STAGES: string[] = [
  "待排产", "已排产", "色粉开单", "色粉称量",
  "混料工序", "挤出工序", "颜色确认中", "已入库",
  "质检中", "创建交货单",
];

/** Mock 订单数据 */
export const MOCK_ORDERS: Order[] = [
  {
    order_no: "ZS-2026-001",
    product_name: "PC阻燃材料-A01",
    customer: "华为技术",
    current_stage: "挤出工序",
    stage_status: "进行中",
    planned_date: "2026-06-02",
    assignee: "张工",
    base_name: "广州基地",
    notes: "客户要求加急",
    stages: [
      { stage: "待排产", status: "已完成", date: "2026-05-20", operator: "系统" },
      { stage: "已排产", status: "已完成", date: "2026-05-21", operator: "李主管" },
      { stage: "色粉开单", status: "已完成", date: "2026-05-22", operator: "王工" },
      { stage: "色粉称量", status: "已完成", date: "2026-05-23", operator: "赵工" },
      { stage: "混料工序", status: "已完成", date: "2026-05-25", operator: "钱工" },
      { stage: "挤出工序", status: "进行中", date: "2026-05-28", operator: "孙工" },
    ],
  },
  {
    order_no: "ZS-2026-002",
    product_name: "PA66增强材料-B03",
    customer: "比亚迪",
    current_stage: "混料工序",
    stage_status: "进行中",
    planned_date: "2026-06-05",
    assignee: "刘工",
    base_name: "上海基地",
    notes: null,
    stages: [
      { stage: "待排产", status: "已完成", date: "2026-05-22", operator: "系统" },
      { stage: "已排产", status: "已完成", date: "2026-05-23", operator: "陈主管" },
      { stage: "色粉开单", status: "已完成", date: "2026-05-24", operator: "周工" },
      { stage: "色粉称量", status: "已完成", date: "2026-05-26", operator: "吴工" },
      { stage: "混料工序", status: "进行中", date: "2026-05-28", operator: "郑工" },
    ],
  },
  {
    order_no: "ZS-2026-003",
    product_name: "PP耐候材料-C07",
    customer: "宁德时代",
    current_stage: "待排产",
    stage_status: "等待中",
    planned_date: "2026-06-10",
    assignee: null,
    base_name: "成都基地",
    notes: "大批量订单，约50吨",
    stages: [
      { stage: "待排产", status: "等待中", date: "2026-05-27", operator: "系统" },
    ],
  },
];

/** 各基地待处理订单数（mock） */
export const MOCK_BASE_PENDING: Record<string, number> = {
  "广州基地": 35,
  "上海基地": 22,
  "成都基地": 15,
  "武汉基地": 28,
  "天津基地": 48,
};

/** 基地设备产能配置（生产环境从数据库读取） */
export interface BaseConfig {
  name: string;
  location: string;
  machine_count: number;
  per_machine_daily_output: number;
}

export const BASE_CONFIGS: BaseConfig[] = [
  { name: "广州基地", location: "广东广州", machine_count: 12, per_machine_daily_output: 8 },
  { name: "上海基地", location: "上海", machine_count: 10, per_machine_daily_output: 10 },
  { name: "成都基地", location: "四川成都", machine_count: 15, per_machine_daily_output: 7 },
  { name: "武汉基地", location: "湖北武汉", machine_count: 9, per_machine_daily_output: 9 },
  { name: "天津基地", location: "天津", machine_count: 8, per_machine_daily_output: 6 },
];

// ============================================
// 数据访问函数（替代 Python 的 MockAdapter）
// ============================================

export function getOrderOfNo(orderNo: string): Order | undefined {
  return MOCK_ORDERS.find((o) => o.order_no === orderNo);
}

/** 返回订单信息（不含 stages） */
export function getOrderInfo(orderNo: string): Omit<Order, "stages"> | null {
  const order = getOrderOfNo(orderNo);
  if (!order) return null;
  const { stages: _stages, ...info } = order;
  return info;
}

export function getOrderStages(orderNo: string): OrderStage[] {
  return getOrderOfNo(orderNo)?.stages ?? [];
}

export function searchOrders(keyword: string): Omit<Order, "stages">[] {
  const kw = keyword.toLowerCase();
  return MOCK_ORDERS.filter(
    (o) =>
      o.order_no.toLowerCase().includes(kw) ||
      o.product_name.toLowerCase().includes(kw) ||
      o.customer.toLowerCase().includes(kw),
  ).map(({ stages: _stages, ...info }) => info);
}

export function getPendingOrdersByBase(baseName: string): number {
  return MOCK_BASE_PENDING[baseName] ?? 0;
}
