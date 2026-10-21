/**
 * PI Agent Module
 *
 * 中试生产管理 Agent：订单进度查询 + 产能负荷分析 + 下单推荐 + 交期估算。
 * 基于 pi-coding-agent 框架，提供：
 * - 自定义工具（7 个领域工具）
 * - Skills（order-progress / capacity-analysis / output-format）
 * - 多供应商模型装配
 * - JSONL 会话持久化 + 自动压缩
 * - 事件订阅
 */

// ── Types ──────────────────────────────────────
export type {
  AgentConfig,
  AgentEvent,
  AgentEventHandler,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolEndEvent,
  AgentDoneEvent,
  TurnEndEvent,
  ErrorEvent,
} from "./types";

// ── Tools ──────────────────────────────────────
export {
  queryOrderProgressTool,
  queryOrdersListTool,
  searchOrdersTool,
  getProductionStagesTool,
  analyzeCapacityTool,
  recommendBaseTool,
  estimateDeliveryTool,
  agentTools,
  TOOL_NAMES,
} from "./tools";

// ── Configuration ─────────────────────────────
export {
  getEnvConfig,
  getModelFallbackChain,
  orderProgressSkill,
  capacityAnalysisSkill,
  outputFormatSkill,
  getDefaultSkills,
  defaultAgentConfig,
} from "./config";

// ── Events ─────────────────────────────────────
export { subscribeToEvents, printEvent } from "./events";

// ── Session ────────────────────────────────────
export { createSession, resolveModelChain } from "./session";

// ── Model Fallback（额度用尽自动降级） ─────────
export {
  runPromptWithModelFallback,
  isQuotaExhaustedError,
  type ModelFallbackOptions,
  type FallbackRunResult,
} from "./modelFallback";

// ── Auth & Permission ─────────────────────────
export {
  runWithUser,
  getCurrentUser,
  requireCurrentUser,
  type UserContext,
  type UserRole,
} from "./services/userContext";
export { checkPermission, type PermissionResult } from "./services/permissionGuard";

// ── Business Scopes（MaxKB 多智能体分流） ──────
export { SCOPES, resolveScopeByModel, type BusinessScope } from "./scopes";

// ── Data Layer（SQL Server 数据层，供 server 开放接口直连） ──
// 纯查询函数（@param 参数化、只读），不依赖 Agent 框架与 ALS 用户上下文。
// 注意：外部开放接口应直连此层而非工具层——工具层 SQL 失败时会降级返回 mock 数据。
export {
  queryOrderProgress,
  queryOrderProgressMany,
  queryOrdersList,
  resolveBusinessTypes,
  ALL_BASE_NAMES,
  DEFAULT_LIST_LIMIT,
  type BaseName,
  type OrderProgressResult,
  type OrderListFilters,
  type OrderListTypeResult,
} from "./services/sqlServer";
