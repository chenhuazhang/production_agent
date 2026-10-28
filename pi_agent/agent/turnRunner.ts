/**
 * runTurn — 一回合的唯一入口
 *
 * 「跑一轮对话」以前有三份实现：chat.ts 的 SSE、openai_compat 的流式、
 * openai_compat 的同步聚合。三处各自翻译底层事件、各自补页脚、各自映射错误，
 * 而本该做这件事的 events.ts 反而没人用。
 *
 * 现在这里产出与传输无关的 TurnEvent：
 *   text / thinking / tool_start / tool_end / done / error
 * 传输层只决定怎么编码：
 *   - SSE          → event: text_delta / tool_start / ...
 *   - OpenAI 兼容  → chat.completion.chunk
 *   - 同步 JSON    → 累加 text
 *
 * 模型额度降级仍在 runPromptWithModelFallback 内完成；失败回合的事件不会外泄。
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { runPromptWithModelFallback } from "./modelFallback.js";
import type { UserContext } from "./services/userContext.js";

type AnyModel = Model<any>;

export type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; toolName: string; args: Record<string, unknown> }
  | { type: "tool_end"; toolName: string; isError: boolean; result?: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export type TurnResult =
  | { status: "ok" }
  | { status: "error"; message: string };

export interface RunTurnOptions {
  session: AgentSession;
  text: string;
  user: UserContext;
  modelChain: AnyModel[];
  /** 成功回合末尾追加的文本；不写入会话历史，只给传输层 */
  footer?: string;
  onEvent: (event: TurnEvent) => void;
}

/**
 * 执行一回合，把底层事件翻译成 TurnEvent。
 * 返回后调用方负责把 error 转成对外响应。
 */
export async function runTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const { session, text, user, modelChain, footer, onEvent } = opts;
  let footerSent = false;

  const result = await runPromptWithModelFallback({
    session,
    text,
    user,
    modelChain,
    onEvent: (raw) => {
      switch (raw.type) {
        case "message_update": {
          const ev = raw.assistantMessageEvent;
          if (ev.type === "text_delta") onEvent({ type: "text", delta: ev.delta });
          else if (ev.type === "thinking_delta") onEvent({ type: "thinking", delta: ev.delta });
          break;
        }
        case "tool_execution_start":
          onEvent({
            type: "tool_start",
            toolName: raw.toolName,
            args: (raw.args ?? {}) as Record<string, unknown>,
          });
          break;
        case "tool_execution_end":
          onEvent({
            type: "tool_end",
            toolName: raw.toolName,
            isError: raw.isError,
            result: raw.result,
          });
          break;
        case "agent_end":
          // 只补一次页脚：框架重试可能让 agent_end 触发多次
          if (footer && !footerSent) {
            footerSent = true;
            onEvent({ type: "text", delta: `\n\n${footer}` });
          }
          onEvent({ type: "done" });
          break;
        default:
          break;
      }
    },
  });

  if (result.status === "error") onEvent({ type: "error", message: result.message });
  return result;
}
