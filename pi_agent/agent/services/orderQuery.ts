/**
 * OrderQuery — 「查一张单」的唯一实现
 *
 * 工具层（给 LLM）和开放接口（给外部系统）都要回答同一串问题：
 * 在哪些业务范围查、主表没命中要不要查登记表、全部 SQL 失败算不算「没找到」。
 * 这两条路径以前各写一遍，判定与提示文案已经分叉。
 *
 * 这里只做判定，不产出任何面向用户的措辞；调用方按自己的协议渲染：
 *   - 工具层 → textResult（给 LLM 读的 JSON）
 *   - 开放接口 → HTTP 状态码 + { ok, error }
 */

import type { BaseName } from "./businessScopes.js";
import {
  queryOrderProgressMany,
  queryPendingOrder,
  type OrderProgressResult,
  type PendingOrderResult,
} from "./sqlServer.js";

/** 单个业务范围里的 SQL 失败 */
export interface ScopeError {
  base: BaseName;
  error: string;
}

export type OrderLookup =
  /** 至少一个业务范围命中主表 */
  | { kind: "found"; matches: OrderProgressResult[]; errors: ScopeError[] }
  /** 主表没命中，但登记表有记录（尚未排产） */
  | { kind: "pending"; pending: PendingOrderResult }
  /** 所有业务范围的 SQL 都失败——不能报「未找到」 */
  | { kind: "unavailable"; errors: ScopeError[] }
  /** 查询正常完成，确实没有这张单 */
  | { kind: "not_found"; queried: BaseName[]; errors: ScopeError[] };

function toScopeErrors(
  results: Array<OrderProgressResult | (OrderProgressResult & { error: string })>,
): ScopeError[] {
  return results
    .filter((r): r is OrderProgressResult & { error: string } => "error" in r)
    .map((r) => ({ base: r.base, error: r.error }));
}

/**
 * 按订单号查询：主表并行命中 → 登记表兜底。
 *
 * @param orderNo 订单号
 * @param bases   已按权限收窄过的业务范围（空数组视为查全部）
 */
export async function lookupOrder(
  orderNo: string,
  bases: BaseName[],
  opts: { includePending?: boolean } = {},
): Promise<OrderLookup> {
  const results = await queryOrderProgressMany(orderNo, bases);
  const matches = results.filter(
    (r): r is OrderProgressResult => r.found && !("error" in r),
  );
  if (matches.length > 0) return { kind: "found", matches, errors: toScopeErrors(results) };

  // 排产前订单只登记在 7367 / 7293 两张登记表，主表查不到是正常的。
  // 开放接口保持原有契约（不查登记表），由调用方显式关闭。
  if (opts.includePending !== false) {
    const pending = await queryPendingOrder(orderNo);
    if (pending.found) return { kind: "pending", pending };
  }

  const errors = toScopeErrors(results);
  if (results.length > 0 && errors.length === results.length) {
    return { kind: "unavailable", errors };
  }
  return { kind: "not_found", queried: bases, errors };
}

/** 「未找到」的统一解释：单号、审批、数据窗口三种原因 */
export const NOT_FOUND_HINT =
  "未找到的可能原因：① 订单号不正确；② PLM 和 OA 的流程审批尚未走完——订单需通过 PLM 和 OA 审批后才会流转进 MYEXCEL 进行排产，未排产且尚未登记的订单查询不到，请确认审批流程是否已走完；③ 订单过旧，系统仅查询最近 3 个月内有工序活动的订单。";

/** 指定了业务范围时的提示：额外给出其他可尝试的范围 */
export function singleScopeHint(base: BaseName, others: readonly BaseName[]): string {
  return (
    "订单号是否正确？也可能是 PLM 和 OA 的流程审批尚未走完——订单需通过 PLM 和 OA 审批后才会流转进 MYEXCEL 进行排产，未排产且尚未登记的订单查询不到，请确认审批流程是否已走完。" +
    `也可尝试其他业务范围: ${others.filter((b) => b !== base).join(", ")}。另外系统仅查询最近 3 个月内有工序活动的订单，更早的订单查不到。`
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 since/until；返回错误文案，null = 通过。工具与开放接口共用同一口径。 */
export function validateDateRange(since?: string, until?: string): string | null {
  if (since && !DATE_RE.test(since)) return `since 格式无效（应为 YYYY-MM-DD）: ${since}`;
  if (until && !DATE_RE.test(until)) return `until 格式无效（应为 YYYY-MM-DD）: ${until}`;
  if (since && until && since > until) return `since (${since}) 不能晚于 until (${until})`;
  return null;
}
