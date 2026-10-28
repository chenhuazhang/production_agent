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

// ── Session ────────────────────────────────────
export { createSession, resolveModelChain } from "./session";

// ── Turn Runner（一回合的唯一实现） ───────────────
export { runTurn, type TurnEvent, type TurnResult } from "./turnRunner";

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
export {
  checkPermission,
  allowedTypes,
  narrowTypes,
  OPEN_API_PRINCIPAL,
  type PermissionResult,
} from "./services/access";

// ── Business Scopes（MaxKB 多智能体分流） ──────
export { SCOPES, resolveScopeByModel, type AssistantScope } from "./scopes";

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
  BUSINESS_SCOPES,
  scopeOf,
  type BaseName,
  type BusinessScope,
  type OrderProgressResult,
  type OrderListFilters,
  type OrderListTypeResult,
} from "./services/sqlServer";

// ── Order Query（工具与开放接口共用的判定层） ──
export {
  lookupOrder,
  validateDateRange,
  NOT_FOUND_HINT,
  type OrderLookup,
  type ScopeError,
} from "./services/orderQuery";
