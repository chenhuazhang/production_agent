/**
 * 业务范围定义（MaxKB 多智能体按模型名分流）
 *
 * 企业微信机器人 → MaxKB 应用 → 模型名 → 本服务按 body.model 路由到对应业务范围。
 * - production-agent      ：全部 5 类（Web 端 / 兼容旧配置）
 * - production-agent-gz   ：仅 广州送样&小订单
 * - production-agent-main ：其余 4 类（广州工艺实验 / 小试 / 上海工艺实验 / OA辅助单）
 */

import { ALL_BASE_NAMES, type BaseName } from "./services/sqlServer.js";

export interface AssistantScope {
  /** 范围标识（与模型名对应） */
  key: string;
  label: string;
  /** 允许查询的业务类型 */
  types: BaseName[];
  /** 注入系统提示的范围说明（空串 = 不注入） */
  note: string;
}

const SCOPE_ALL_NOTE =
  "本助手支持全部 5 个业务范围：广州工艺实验 / 广州送样&小订单 / 小试（全集团）/ 上海工艺实验 / OA辅助单（全集团）。";

const SCOPE_GZ_NOTE =
  "业务范围限制：本助手**只处理「广州送样&小订单」**这一种业务。查单时 business_types/base 只能使用「广州送样&小订单」。" +
  "如果用户询问其他业务（广州工艺实验 / 小试 / 上海工艺实验 / OA辅助单 等），请明确告知：本机器人仅负责「广州送样&小订单」，请通过对应机器人咨询其他业务。";

const SCOPE_MAIN_NOTE =
  "业务范围限制：本助手处理 4 类业务：广州工艺实验 / 小试（全集团，研发实验）/ 上海工艺实验 / OA辅助单（注塑单、研发辅助单）。" +
  "**不处理「广州送样&小订单」**；如果用户询问该业务，请明确告知：本机器人不负责「广州送样&小订单」，请通过对应机器人咨询。";

export const SCOPES: Record<string, AssistantScope> = {
  all: {
    key: "all",
    label: "全部业务",
    types: [...ALL_BASE_NAMES],
    note: SCOPE_ALL_NOTE,
  },
  "gz-sample": {
    key: "gz-sample",
    label: "仅广州送样&小订单",
    types: ["广州送样&小订单"],
    note: SCOPE_GZ_NOTE,
  },
  main: {
    key: "main",
    label: "广州工艺实验 / 小试 / 上海工艺实验 / OA辅助单",
    types: [
      "广州工艺实验",
      "小试",
      "上海工艺实验",
      "OA辅助单",
    ],
    note: SCOPE_MAIN_NOTE,
  },
};

/**
 * 模型名 → 业务范围。未知模型名回退到全部（兼容旧配置）。
 */
export function resolveScopeByModel(modelName: string): AssistantScope {
  const key = String(modelName || "").trim().toLowerCase();
  if (key === "production-agent-gz") return SCOPES["gz-sample"];
  if (key === "production-agent-main") return SCOPES.main;
  return SCOPES.all;
}
