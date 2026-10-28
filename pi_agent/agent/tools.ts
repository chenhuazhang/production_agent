/**
 * Agent Custom Tools
 *
 * 7 个中试生产领域工具，移植自 Python 版 ai_service/app/tools/。
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
  queryOrdersList,
  resolveBusinessTypes,
  getRealTimePendingCounts,
  ALL_BASE_NAMES,
  DEFAULT_LIST_LIMIT,
  type BaseName,
} from "./services/sqlServer.js";
import { allowedTypes, checkPermission, narrowTypes } from "./services/access.js";
import {
  NOT_FOUND_HINT,
  lookupOrder,
  singleScopeHint,
  validateDateRange,
} from "./services/orderQuery.js";

// ============================================
// 工具：查询订单进度
// ============================================

export const queryOrderProgressTool = defineTool({
  name: "query_order_progress",
  label: "查询订单进度",
  description:
    "从 SQL Server 查询指定订单的真实生产进度（负责人、各工序时间、异常信息等）。" +
    `支持 ${ALL_BASE_NAMES.length} 个业务范围: ${ALL_BASE_NAMES.join(" / ")}。` +
    "订单号含 EX 的属于工艺实验类（广州工艺实验 / 上海工艺实验 / 小试），" +
    "上海工艺实验的技术员记录在「技术配方备注」字段里。" +
    `如未指定 base，将并行查询全部 ${ALL_BASE_NAMES.length} 个业务范围并返回命中的那个。` +
    "注意：仅能查到最近 3 个月内有工序活动的订单，更早的订单查不到（查不到时应如实说明数据窗口限制，不要断定订单不存在）。" +
    "查不到时也应提示：订单需通过 PLM 和 OA 的流程审批后才会流转进 MYEXCEL 进行排产，可能是审批流程尚未走完，建议用户确认审批流程是否已完成。",
  parameters: Type.Object({
    order_no: Type.String({ description: "订单编号" }),
    base: Type.Optional(
      Type.Union(
        [
          Type.Literal("广州工艺实验"),
          Type.Literal("广州送样&小订单"),
          Type.Literal("小试"),
          Type.Literal("上海工艺实验"),
          Type.Literal("OA辅助单"),
        ],
        {
          description:
            `业务范围名称，可选。不传则并行查询 ${ALL_BASE_NAMES.length} 个业务范围: ${ALL_BASE_NAMES.join(", ")}。` +
            "订单号含 EX → 广州工艺实验 / 上海工艺实验 / 小试；不含 EX → 广州送样&小订单；OA辅助单不限。",
        },
      ),
    ),
  }),
  execute: async (_id, params) => {
    const perm = checkPermission("query_order_progress", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });

    const { order_no, base } = params as { order_no: string; base?: BaseName };
    const allowed = allowedTypes();

    if (base && !allowed.includes(base)) {
      return textResult({
        error: `本助手不支持业务范围「${base}」`,
        hint: `可查询的业务范围: ${allowed.join(" / ")}`,
      });
    }

    const basesToQuery = base ? [base] : allowed;

    try {
      const result = await lookupOrder(order_no, basesToQuery);
      switch (result.kind) {
        case "found":
          if (base) return textResult(result.matches[0]);
          return textResult({
            matches: result.matches,
            note: result.matches.length > 1 ? "同一订单号在多个业务范围命中，请确认" : undefined,
          });
        case "pending":
          return textResult(result.pending);
        case "unavailable":
          // 全部业务范围都查失败：不能报「未找到」
          return textResult({
            error: "SQL Server 查询失败，本次结果不可用",
            detail: result.errors.map((e) => `${e.base}: ${e.error}`).join("; "),
            hint: "查询没有成功完成，不能据此判断订单不存在，请稍后重试或联系计划岗。",
          });
        case "not_found":
          if (base) {
            return textResult({
              error: `业务范围 ${base} 未找到订单 ${order_no}`,
              hint: singleScopeHint(base, ALL_BASE_NAMES),
            });
          }
          return textResult({
            error: `${basesToQuery.length} 个业务范围均未找到订单 ${order_no}`,
            hint: NOT_FOUND_HINT,
            hints: result.errors.length
              ? { db_errors: result.errors.map((e) => `${e.base}: ${e.error}`) }
              : undefined,
          });
      }
      const exhaustive: never = result;
      return exhaustive;
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
// 工具：订单列表查询（多维：技术员 / 类型 / 基地 / 时间）
// ============================================

export const queryOrdersListTool = defineTool({
  name: "query_orders_list",
  label: "订单列表查询",
  description:
    "按技术员 / 牌号 / 产品线 / 业务类型 / 基地 / 排产时间范围批量查询订单列表，返回订单摘要（单号、机台、牌号、产品线、技术员、状态、异常等）。" +
    "适用于没有具体订单号的问法，例如：" +
    "「XXX 目前的订单情况」（按技术员）、「XXX 今天下的单有哪些」（technician + since/until=今天）、「牌号 ABC 目前的进度」（grade）、「PP 产品线当前的订单情况」（product_line，回答时按业务类型分别统计单量）、「广州小试这一个月的订单情况」（按类型+基地+时间）、「工艺实验这个月的订单」（按类型别名+时间）。" +
    "business_types 支持别名：研发实验=小试；工艺实验=广州工艺实验+上海工艺实验；注塑单/研发辅助单=OA辅助单；送样/小订单=广州送样&小订单。" +
    "时间一律按排产时间过滤（包括「下的单 / 开的单」这类说法，不用开单时间）。如需某订单的工序明细，用其订单号调用 query_order_progress。" +
    "注意：无论 since 传多早，系统只返回最近 3 个月内有工序活动的订单（数据窗口硬限制），用户问更早时段时应如实说明。",
  parameters: Type.Object({
    technician: Type.Optional(
      Type.String({
        description: "技术员姓名（模糊匹配）。上海工艺实验的技术员写在技术配方备注里，会按备注文本匹配。",
      }),
    ),
    base: Type.Optional(
      Type.String({
        description: "地理基地，如 广州 / 上海 / 成都 等。仅对全集团类型（小试 / OA辅助单）生效；广州/上海特定类型已隐含其基地。",
      }),
    ),
    grade: Type.Optional(
      Type.String({
        description: "产品牌号（模糊匹配）。例：「牌号 ABC123 目前的进度」→ grade=\"ABC123\"。",
      }),
    ),
    product_line: Type.Optional(
      Type.String({
        description: "产品线（模糊匹配）。例：「PP 产品线当前的订单情况」→ product_line=\"PP\"。",
      }),
    ),
    business_types: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "业务类型或别名列表。不传=查询全部 5 个业务范围。" +
          "正式名：广州工艺实验 / 广州送样&小订单 / 小试 / 上海工艺实验 / OA辅助单；" +
          "别名：研发实验=小试；工艺实验=广州工艺实验+上海工艺实验；注塑单/研发辅助单=OA辅助单；送样/小订单=广州送样&小订单。",
      }),
    ),
    since: Type.Optional(
      Type.String({ description: "排产时间起，格式 YYYY-MM-DD（含当天）。" }),
    ),
    until: Type.Optional(
      Type.String({ description: "排产时间止，格式 YYYY-MM-DD（含当天）。" }),
    ),
  }),
  execute: async (_id, params) => {
    const perm = checkPermission("query_orders_list", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });

    const { technician, base, grade, product_line, business_types, since, until } = params as {
      technician?: string;
      base?: string;
      grade?: string;
      product_line?: string;
      business_types?: string[];
      since?: string;
      until?: string;
    };

    // 日期格式校验（与开放接口共用同一口径）
    const dateError = validateDateRange(since, until);
    if (dateError) return textResult({ error: dateError });

    // 别名展开 + 归一（未知别名返回错误 + 可用清单）
    let types: BaseName[];
    try {
      types = resolveBusinessTypes(business_types);
    } catch (err) {
      return textResult({ error: err instanceof Error ? err.message : String(err) });
    }

    // 业务范围钳制（MaxKB 多智能体按模型名分流）：统一由 access 模块判定
    const allowed = allowedTypes();
    const scoped = narrowTypes(types);
    if (scoped.length === 0) {
      return textResult({
        error: `本助手仅支持以下业务范围: ${allowed.join(" / ")}`,
        hint: "所请求的业务类型不在本助手范围内，请使用对应的机器人咨询。",
      });
    }
    types = scoped;

    // 无任何过滤条件 → 默认近 90 天排产窗口（避免全表扫描）
    let effSince = since;
    let defaultWindow = false;
    if (!technician && !base && !grade && !product_line && !since && !until) {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      effSince = d.toISOString().slice(0, 10);
      defaultWindow = true;
    }

    try {
      const { results, total } = await queryOrdersList({
        types,
        technician,
        base,
        grade,
        product_line,
        since: effSince,
        until,
      });

      if (total === 0) {
        const issues = results
          .filter((r) => r.error || r.skipped)
          .map((r) => `${r.type}: ${r.error ?? r.skipped}`);
        return textResult({
          error: "未找到匹配的订单",
          filters_applied: { technician, base, grade, product_line, business_types: types, since: effSince, until },
          hints: issues.length ? issues : ["可尝试放宽时间范围或减少过滤条件"],
        });
      }

      const truncatedTypes = results.filter((r) => r.truncated).map((r) => r.type);
      return textResult({
        filters_applied: { technician, base, grade, product_line, business_types: types, since: effSince, until },
        default_window: defaultWindow || undefined,
        total,
        // 每业务类型单量统计（count/completed 为真实总数，不受明细截断影响）
        by_type: results
          .filter((r) => r.count > 0 || r.skipped || r.error)
          .map((r) => ({
            type: r.type,
            count: r.count,
            completed: r.completed,
            in_progress: typeof r.completed === "number" ? r.count - r.completed : undefined,
            skipped: r.skipped,
            error: r.error,
          })),
        results,
        // 按产品线统计（不截断，跨类型合并）：精确回答「各产品线分别多少单」，不受 200 条明细限制影响
        by_line: mergeByLine(results),
        truncated_note: truncatedTypes.length
          ? `以下类型订单较多，明细仅节选最近 ${DEFAULT_LIST_LIMIT} 条，但 by_type / by_line 的统计数量为实际总数: ${truncatedTypes.join(", ")}`
          : undefined,
        hint: "如需某订单的工序明细，用其订单号调用 query_order_progress",
      });
    } catch (err) {
      // SQL Server 连接/查询失败 → 明确错误（列表查询无 mock 降级）
      return textResult({
        error: "SQL Server 查询失败",
        detail: err instanceof Error ? err.message : String(err),
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
    const perm = checkPermission("search_orders", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });

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
  execute: async (_id, params) => {
    const perm = checkPermission("get_production_stages", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });
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
    const perm = checkPermission("analyze_capacity", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });

    const { base_name } = params as { base_name?: string };

    // 尝试从 SQL Server 获取实时待处理数
    let realCounts: Map<string, number> = new Map();
    try {
      const snapshots = await getRealTimePendingCounts(90);
      for (const s of snapshots) {
        realCounts.set(s.baseName, s.pendingOrders);
      }
    } catch (err) {
      console.warn("[capacity] SQL query failed, using mock fallback:", err instanceof Error ? err.message : err);
    }

    function getPending(baseName: string): number {
      return realCounts.get(baseName) ?? getPendingOrdersByBase(baseName);
    }

    if (base_name) {
      const config = BASE_CONFIGS.find((c) => c.name === base_name);
      if (!config) return textResult({ error: `未找到基地: ${base_name}` });
      const pending = getPending(config.name);
      const result = analyzeBaseCapacity({
        base_name: config.name,
        location: config.location,
        machine_count: config.machine_count,
        per_machine_daily_output: config.per_machine_daily_output,
        pending_orders: pending,
      });
      return textResult({
        base: result,
        data_source: realCounts.has(config.name) ? "SQL Server 实时数据" : "模拟数据",
      });
    }

    const bases: BaseCapacity[] = BASE_CONFIGS.map((config) => {
      const pending = getPending(config.name);
      return analyzeBaseCapacity({
        base_name: config.name,
        location: config.location,
        machine_count: config.machine_count,
        per_machine_daily_output: config.per_machine_daily_output,
        pending_orders: pending,
      });
    });

    return textResult({
      bases,
      total_bases: bases.length,
      data_source: realCounts.size > 0 ? "SQL Server 实时数据" : "模拟数据",
    });
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
  execute: async (_id, params) => {
    const perm = checkPermission("recommend_base", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });

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
    const perm = checkPermission("estimate_delivery", params as Record<string, unknown>);
    if (!perm.allowed) return textResult({ error: perm.reason });

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
  queryOrdersListTool,
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

/**
 * 合并各业务类型的产品线统计为一份跨类型汇总（按产品线名求和）。
 * 同一产品线可能分布在多个业务类型（如「PP」在广州工艺实验和小试都有），
 * 回答「各产品线分别多少单」时跨类型累加才准确。
 * 返回按 total 降序排列。
 */
function mergeByLine(results: Array<{ by_line?: Array<{ product_line: string; total: number; completed: number }> }>) {
  const map = new Map<string, { product_line: string; total: number; completed: number }>();
  for (const r of results) {
    for (const line of r.by_line ?? []) {
      const key = line.product_line;
      const cur = map.get(key);
      if (cur) {
        cur.total += line.total;
        cur.completed += line.completed;
      } else {
        map.set(key, { product_line: line.product_line, total: line.total, completed: line.completed });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
