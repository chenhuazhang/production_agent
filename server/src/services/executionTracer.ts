/**
 * ExecutionTracer - Agent 执行日志系统
 *
 * 记录每次对话的完整推理链路：
 * - LLM 文本输出（汇总）
 * - 每次工具调用的输入/输出/耗时
 * - 总耗时 + 错误信息
 *
 * 持久化到 JSONL 文件：data/logs/traces/{YYYY-MM-DD}.jsonl
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { UserContext } from "pi-agent";

// ============================================
// 类型
// ============================================

export interface ToolStep {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export interface ExecutionTrace {
  traceId: string;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  userInput: string;
  user?: UserContext;
  outputText: string;
  toolSteps: ToolStep[];
  error?: string;
}

type RawEvent = Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];

// ============================================
// Tracer
// ============================================

export class ExecutionTracer {
  private active = new Map<string, ExecutionTrace>();

  /** 开始一次 trace，返回 traceId */
  start(sessionId: string, userInput: string, user?: UserContext): string {
    const traceId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.active.set(traceId, {
      traceId,
      sessionId,
      startedAt: new Date().toISOString(),
      userInput,
      user,
      outputText: "",
      toolSteps: [],
    });
    return traceId;
  }

  /** 订阅底层事件，记录工具调用和文本 */
  record(raw: RawEvent, traceId: string): void {
    const t = this.active.get(traceId);
    if (!t) return;

    switch (raw.type) {
      case "message_update": {
        if (raw.assistantMessageEvent.type === "text_delta") {
          t.outputText += raw.assistantMessageEvent.delta;
        }
        break;
      }
      case "tool_execution_start": {
        t.toolSteps.push({
          toolName: raw.toolName,
          args: (raw.args ?? {}) as Record<string, unknown>,
          isError: false,
          startedAt: new Date().toISOString(),
        });
        break;
      }
      case "tool_execution_end": {
        const step = [...t.toolSteps].reverse().find((s: ToolStep) => s.toolName === raw.toolName && !s.endedAt);
        if (step) {
          step.result = raw.result;
          step.isError = raw.isError;
          step.endedAt = new Date().toISOString();
          step.durationMs =
            new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
        }
        break;
      }
      case "agent_end": {
        // 工具步骤可能还在 agent_end 之后提交——不强制此处写文件
        break;
      }
      case "turn_end": {
        // turn_end 可能早于 agent_end，不在此处 persist
        // 最终由 finish() 统一落盘
        break;
      }
    }
  }

  /** 标记完成并持久化 */
  finish(traceId: string): void {
    const t = this.active.get(traceId);
    if (t) {
      t.endedAt = new Date().toISOString();
      t.durationMs = new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime();
      this.persist(traceId);
    }
  }

  /** 标记错误 */
  error(traceId: string, message: string): void {
    const t = this.active.get(traceId);
    if (t) {
      t.error = message;
      t.endedAt = new Date().toISOString();
      t.durationMs = new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime();
      this.persist(traceId);
    }
  }

  // ==========================================
  // 持久化
  // ==========================================

  private persist(traceId: string): void {
    const t = this.active.get(traceId);
    if (!t) return;
    this.active.delete(traceId);

    try {
      const today = new Date().toISOString().slice(0, 10); // "2026-06-26"
      const logsDir = path.resolve(process.cwd(), "data", "logs", "traces");
      fs.mkdirSync(logsDir, { recursive: true });

      const file = path.join(logsDir, `${today}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(t) + "\n", "utf-8");
    } catch (err) {
      console.error("[ExecutionTracer] persist failed:", err);
    }
  }
}
