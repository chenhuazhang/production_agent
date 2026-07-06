/**
 * PI Agent Module
 *
 * 中试生产管理 Agent：订单进度查询 + 产能负荷分析 + 下单推荐 + 交期估算。
 * 基于 pi-coding-agent 框架，提供：
 * - 自定义工具（6 个领域工具）
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
  orderProgressSkill,
  capacityAnalysisSkill,
  outputFormatSkill,
  getDefaultSkills,
  defaultAgentConfig,
} from "./config";

// ── Events ─────────────────────────────────────
export { subscribeToEvents, printEvent } from "./events";

// ── Session ────────────────────────────────────
export { createSession } from "./session";

// ── Auth & Permission ─────────────────────────
export {
  runWithUser,
  getCurrentUser,
  requireCurrentUser,
  type UserContext,
  type UserRole,
} from "./services/userContext";
export { checkPermission, type PermissionResult } from "./services/permissionGuard";
