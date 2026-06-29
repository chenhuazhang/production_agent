/**
 * Agent Types
 *
 * 所有类型定义集中在此，方便维护与复用。
 */

import type { AgentSession, Skill } from "@earendil-works/pi-coding-agent";

// ============================================
// 配置类型
// ============================================

export interface AgentConfig {
  /** 工作目录 */
  cwd?: string;
  /** 模型名称，默认 deepseek-v4-flash */
  model?: string;
  /** 额外的 Skills */
  skills?: Skill[];
}

export interface EnvConfig {
  /** 模型供应商，如 deepseek / openai / qwen */
  provider: string;
  apiKey: string;
  model: string;
}

// ============================================
// 事件类型
// ============================================

export interface TextDeltaEvent {
  type: "text_delta";
  delta: string;
}

export interface ToolStartEvent {
  type: "tool_start";
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent {
  type: "tool_end";
  toolName: string;
  isError: boolean;
  result?: unknown;
}

export interface AgentDoneEvent {
  type: "done";
  messageCount: number;
}

export interface TurnEndEvent {
  type: "turn_end";
  toolResultCount: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type AgentEvent =
  | TextDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentDoneEvent
  | TurnEndEvent
  | ErrorEvent;

export type AgentEventHandler = (event: AgentEvent) => void;

export type { AgentSession, Skill };
