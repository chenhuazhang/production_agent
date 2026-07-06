/**
 * AI Service Client
 *
 * 消费 pi-coding-agent 的 SSE 事件流。
 * 事件类型：text_delta / tool_start / tool_end / done / error
 *
 * URL 由 env AI_API_URL 配置，向后兼容 PYTHON_API_URL，默认 http://localhost:8000
 */

// 服务端用内网地址，浏览器用相对路径（走 Next.js 代理）
const AI_API_URL =
  typeof window === "undefined"
    ? (process.env.AI_API_URL || process.env.PYTHON_API_URL || "http://localhost:8000")
    : "";

export interface ChatRequest {
  message: string;
  conversation_id?: string;
  user_id?: string;
}

/** SSE 事件回调 */
export interface StreamHandlers {
  onTextDelta?: (delta: string) => void;
  /** 模型的内部思考链（reasoning tokens），前端展示为可折叠灰色框 */
  onThinkingDelta?: (delta: string) => void;
  onToolStart?: (toolName: string, args: Record<string, unknown>) => void;
  onToolEnd?: (toolName: string, isError: boolean, result: unknown) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

/**
 * 发送聊天消息，流式消费 SSE 事件。
 * @param sessionId 会话 ID（由调用方生成/维护，复用同一 sessionId 可保持上下文）
 */
export async function sendChatMessageStream(
  sessionId: string,
  request: ChatRequest,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${AI_API_URL}/api/chat/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: request.message }),
  });

  if (!response.ok) {
    throw new Error(`AI service error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let done = false;

  while (!done) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以空行分隔
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawBlock = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const dataLines: string[] = [];
      for (const line of rawBlock.split("\n")) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length === 0) continue;
      const dataStr = dataLines.join("\n");

      switch (currentEvent) {
        case "text_delta": {
          const d = safeJson<{ delta?: string }>(dataStr);
          if (d?.delta) handlers.onTextDelta?.(d.delta);
          break;
        }
        case "thinking_delta": {
          const d = safeJson<{ delta?: string }>(dataStr);
          if (d?.delta) handlers.onThinkingDelta?.(d.delta);
          break;
        }
        case "tool_start": {
          const d = safeJson<{ toolName?: string; args?: Record<string, unknown> }>(dataStr);
          if (d?.toolName) handlers.onToolStart?.(d.toolName, d.args ?? {});
          break;
        }
        case "tool_end": {
          const d = safeJson<{ toolName?: string; isError?: boolean; result?: unknown }>(dataStr);
          if (d?.toolName) handlers.onToolEnd?.(d.toolName, !!d.isError, d.result);
          break;
        }
        case "done":
          handlers.onDone?.();
          done = true;
          break;
        case "error": {
          const d = safeJson<{ message?: string }>(dataStr);
          handlers.onError?.(d?.message ?? "Unknown error");
          done = true;
          break;
        }
        default:
          break;
      }
      currentEvent = "message";
    }
  }
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
