/**
 * ExecutionTracer - Agent 执行日志系统
 *
 * 记录每次对话的完整推理链路：
 * - LLM 文本输出（汇总）
 * - 每次工具调用的输入/输出/耗时
 * - 总耗时 + 错误信息
 *
 * 只依赖 TurnEvent（与传输无关），不直接订阅框架事件——
 * 换传输方式（SSE / OpenAI 兼容 / 同步）不影响日志。
 *
 * 持久化到 JSONL 文件：data/logs/traces/{YYYY-MM-DD}.jsonl
 */

import { mkdir, appendFile } from "node:fs/promises";
import * as path from "node:path";
import type { TurnEvent, UserContext } from "pi-agent";

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

  /** 记录一个回合事件 */
  record(event: TurnEvent, traceId: string): void {
    const t = this.active.get(traceId);
    if (!t) return;

    switch (event.type) {
      case "text":
        t.outputText += event.delta;
        break;
      case "tool_start":
        t.toolSteps.push({
          toolName: event.toolName,
          args: event.args,
          isError: false,
          startedAt: new Date().toISOString(),
        });
        break;
      case "tool_end": {
        const step = [...t.toolSteps]
          .reverse()
          .find((s) => s.toolName === event.toolName && !s.endedAt);
        if (step) {
          step.result = event.result;
          step.isError = event.isError;
          step.endedAt = new Date().toISOString();
          step.durationMs =
            new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
        }
        break;
      }
      default:
        break;
    }
  }

  /** 标记完成并持久化 */
  async finish(traceId: string): Promise<void> {
    const t = this.active.get(traceId);
    if (!t) return;
    t.endedAt = new Date().toISOString();
    t.durationMs = new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime();
    await this.persist(traceId);
  }

  /** 标记错误 */
  async error(traceId: string, message: string): Promise<void> {
    const t = this.active.get(traceId);
    if (!t) return;
    t.error = message;
    t.endedAt = new Date().toISOString();
    t.durationMs = new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime();
    await this.persist(traceId);
  }

  private async persist(traceId: string): Promise<void> {
    const t = this.active.get(traceId);
    if (!t) return;
    this.active.delete(traceId);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const logsDir = path.resolve(process.cwd(), "data", "logs", "traces");
      await mkdir(logsDir, { recursive: true });
      await appendFile(path.join(logsDir, `${today}.jsonl`), JSON.stringify(t) + "\n", "utf-8");
    } catch (err) {
      console.error("[ExecutionTracer] persist failed:", err);
    }
  }
}
