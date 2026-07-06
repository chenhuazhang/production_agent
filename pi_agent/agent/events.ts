/**
 * Agent Events
 *
 * 将底层 AgentSession 事件转换为简化的业务事件。
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentEvent, AgentEventHandler } from "./types";

/**
 * 订阅 AgentSession 事件，转成业务事件后回调。
 * @returns 取消订阅函数
 */
export function subscribeToEvents(
  session: AgentSession,
  handler: AgentEventHandler,
): () => void {
  return session.subscribe((rawEvent) => {
    const event = transformEvent(rawEvent);
    if (event) handler(event);
  });
}

type RawEvent = Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];

function transformEvent(raw: RawEvent): AgentEvent | null {
  switch (raw.type) {
    case "message_update": {
      if (raw.assistantMessageEvent.type === "text_delta") {
        return { type: "text_delta", delta: raw.assistantMessageEvent.delta };
      }
      if (raw.assistantMessageEvent.type === "thinking_delta") {
        return { type: "thinking_delta", delta: raw.assistantMessageEvent.delta };
      }
      return null;
    }
    case "tool_execution_start":
      return {
        type: "tool_start",
        toolName: raw.toolName,
        args: raw.args as Record<string, unknown>,
      };
    case "tool_execution_end":
      return {
        type: "tool_end",
        toolName: raw.toolName,
        isError: raw.isError,
        result: raw.result,
      };
    case "agent_end":
      return { type: "done", messageCount: raw.messages.length };
    case "turn_end":
      return { type: "turn_end", toolResultCount: raw.toolResults.length };
    case "message_end": {
      const msg = raw.message;
      if ("stopReason" in msg && msg.stopReason === "error") {
        return { type: "error", message: msg.errorMessage ?? "Unknown error" };
      }
      return null;
    }
    default:
      return null;
  }
}

/** 调试用：把业务事件打印到控制台 */
export function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "thinking_delta":
      process.stdout.write(`\n🧠 [思考] ` + event.delta.slice(0, 80));
      break;
    case "tool_start":
      console.log(`\n🔧 [工具] ${event.toolName}`);
      if (Object.keys(event.args).length > 0) {
        console.log(`   参数: ${JSON.stringify(event.args)}`);
      }
      break;
    case "tool_end":
      console.log(event.isError ? `   ❌ 错误` : `   ✅ 完成`);
      break;
    case "done":
      console.log(`\n✨ [完成] 共 ${event.messageCount} 条消息`);
      break;
    case "turn_end":
      if (event.toolResultCount > 0) {
        console.log(`\n📤 [Turn] ${event.toolResultCount} 个工具结果`);
      }
      break;
    case "error":
      console.error(`\n❌ [错误] ${event.message}`);
      break;
  }
}
