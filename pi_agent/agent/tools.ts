/**
 * Agent Custom Tools
 *
 * 6 个中试生产领域工具，移植自 Python 版 ai_service/app/tools/。
 * 参数用 TypeBox schema，返回 { content: [{type:"text", text}], details }。
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  getOrderInfo,
  getOrderStages,
  searchOrders,
  PRODUCTION_STAGES,
  BASE_CONFIGS,
  getPendingOrdersByBase,
} from "../data/mockData.js";
import {
  analyzeBaseCapacity,
  recommendBase,
  estimateDelivery,
  type BaseCapacity,
} from "../data/capacity.js";
import {
  queryOrderProgress,
  queryOrderProgressMany,
  ALL_BASE_NAMES,
  type BaseName,
} from "./services/sqlServer.js";

// ============================================
// 工具：查询订单进度
// ============================================

export const queryOrderProgressTool = defineTool({
  name: "query_order_progress",
  label: "查询订单进度",
  description:
    "从 SQL Server 查询指定订单的真实生产进度（负责人、各工序时间、异常信息等）。" +
    `支持 4 个基地: ${ALL_BASE_NAMES.join(" / ")}。` +
    "如未指定 base，将并行查询全部 4 个基地并返回命中的那个。",
  parameters: Type.Object({
    order_no: Type.String({ description: "订单编号" }),
    base: Type.Optional(
      Type.Union(
        [
          Type.Literal("中试广州"),
          Type.Literal("小试"),
          Type.Literal("中试上海"),
          Type.Literal("中试天津"),
        ],
        { description: `基地名称，可选。不传则并行查询 4 个基地: ${ALL_BASE_NAMES.join(", ")}` },
      ),
    ),
  }),
  execute: async (_id, params) => {
    const { order_no, base } = params as { order_no: string; base?: BaseName };
    try {
      if (base) {
        const r = await queryOrderProgress(order_no, base);
        if (!r.found) {
          return textResult({
            error: `基地 ${base} 未找到订单 ${order_no}`,
            hint: `订单号是否正确？也可尝试其他基地: ${ALL_BASE_NAMES.filter((b) => b !== base).join(", ")}`,
          });
        }
        return textResult(r);
      }
      // 未指定 base → 并行查 4 个基地
      const results = await queryOrderProgressMany(order_no);
      const found = results.filter((r) => r.found && !("error" in r));
      if (found.length === 0) {
        const errors = results
          .filter((r) => "error" in r)
          .map((r) => `${(r as { base: BaseName }).base}: ${(r as { error?: string }).error}`);
        return textResult({
          error: `4 个基地均未找到订单 ${order_no}`,
          hints: errors.length ? { db_errors: errors } : undefined,
        });
      }
      return textResult({
        matches: found,
        note: found.length > 1 ? "同一订单号在多个基地命中，请确认" : undefined,
      });
    } catch (err) {
      // SQL Server 连接/查询失败 → 返回明确错误让 agent 告知用户
      return textResult({
        error: "SQL Server 查询失败",
        detail: err instanceof Error ? err.message : String(err),
        fallback: "已回退到内存 mock 数据（可能不准确）",
        mock: getOrderInfo(order_no),
      });
    }
  },
});

// ============================================
// 工具：搜索订单
// ============================================

export const searchOrdersTool = defineTool({
  name: "search_orders",
  label: "搜索订单",
  description: "搜索订单，支持按订单号、客户名称、产品名称搜索。",
  parameters: Type.Object({
    keyword: Type.String({ description: "搜索关键词：订单号 / 客户名称 / 产品名称" }),
  }),
  execute: async (_id, params) => {
    const { keyword } = params as { keyword: string };
    const results = searchOrders(keyword);
    const result = results.length
      ? { message: `找到 ${results.length} 条相关订单`, orders: results }
      : { message: `未找到与 '${keyword}' 相关的订单`, orders: [] };
    return textResult(result);
  },
});

// ============================================
// 工具：获取生产流程
// ============================================

export const getProductionStagesTool = defineTool({
  name: "get_production_stages",
  label: "获取生产流程",
  description: "获取中试订单的标准生产流程工序列表。",
  parameters: Type.Object({}),
  execute: async () => {
    return textResult({
      stages: PRODUCTION_STAGES,
      description: "订单从下单到入库的标准生产流程",
    });
  },
});

// ============================================
// 工具：分析产能负荷
// ============================================

export const analyzeCapacityTool = defineTool({
  name: "analyze_capacity",
  label: "分析产能负荷",
  description: "分析中试基地的产能负荷情况，包括负荷率、超负荷倍数、完工天数等。可查询单个基地或全部基地。",
  parameters: Type.Object({
    base_name: Type.Optional(
      Type.String({ description: "基地名称（可选），不传则返回所有基地。例如：广州基地、上海基地" }),
    ),
  }),
  execute: async (_id, params) => {
    const { base_name } = params as { base_name?: string };
    if (base_name) {
      const config = BASE_CONFIGS.find((c) => c.name === base_name);
      if (!config) return textResult({ error: `未找到基地: ${base_name}` });
      const pending = getPendingOrdersByBase(config.name);
      const result = analyzeBaseCapacity({
        base_name: config.name,
        location: config.location,
        machine_count: config.machine_count,
        per_machine_daily_output: config.per_machine_daily_output,
        pending_orders: pending,
      });
      return textResult({ base: result });
    }
    const bases: BaseCapacity[] = BASE_CONFIGS.map((config) => {
      const pending = getPendingOrdersByBase(config.name);
      return analyzeBaseCapacity({
        base_name: config.name,
        location: config.location,
        machine_count: config.machine_count,
        per_machine_daily_output: config.per_machine_daily_output,
        pending_orders: pending,
      });
    });
    return textResult({ bases, total_bases: bases.length });
  },
});

// ============================================
// 工具：推荐下单基地
// ============================================

export const recommendBaseTool = defineTool({
  name: "recommend_base",
  label: "推荐下单基地",
  description: "根据各基地当前产能负荷，智能推荐最适合下单的中试基地。",
  parameters: Type.Object({}),
  execute: async () => {
    const basesData: BaseCapacity[] = BASE_CONFIGS.map((config) => {
      const pending = getPendingOrdersByBase(config.name);
      return analyzeBaseCapacity({
        base_name: config.name,
        location: config.location,
        machine_count: config.machine_count,
        per_machine_daily_output: config.per_machine_daily_output,
        pending_orders: pending,
      });
    });
    const recommendation = recommendBase(basesData);
    return textResult({
      recommendation,
      all_bases_summary: basesData.map((b) => ({
        name: b.base_name,
        load_rate: b.load_rate,
        pending_orders: b.pending_orders,
        daily_capacity: b.daily_capacity,
      })),
    });
  },
});

// ============================================
// 工具：估算交期
// ============================================

export const estimateDeliveryTool = defineTool({
  name: "estimate_delivery",
  label: "估算交期",
  description: "估算在指定基地下新订单的交期天数。",
  parameters: Type.Object({
    base_name: Type.String({ description: "基地名称，例如：广州基地" }),
    order_quantity: Type.Optional(
      Type.Integer({ description: "订单数量（默认 1）" }),
    ),
  }),
  execute: async (_id, params) => {
    const { base_name, order_quantity } = params as {
      base_name: string;
      order_quantity?: number;
    };
    const config = BASE_CONFIGS.find((c) => c.name === base_name);
    if (!config) return textResult({ error: `未找到基地: ${base_name}` });
    const pending = getPendingOrdersByBase(base_name);
    const result = estimateDelivery({
      base_name: config.name,
      machine_count: config.machine_count,
      per_machine_daily_output: config.per_machine_daily_output,
      pending_orders: pending,
      order_quantity: order_quantity ?? 1,
    });
    return textResult(result);
  },
});

// ============================================
// 导出
// ============================================

export const agentTools = [
  queryOrderProgressTool,
  searchOrdersTool,
  getProductionStagesTool,
  analyzeCapacityTool,
  recommendBaseTool,
  estimateDeliveryTool,
];

/** 工具名清单（传给 createAgentSession 的 tools 白名单） */
export const TOOL_NAMES = agentTools.map((t) => t.name);

// ============================================
// 辅助
// ============================================

function textResult(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}
