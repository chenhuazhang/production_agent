/**
 * Agent HTTP 客户端
 *
 * 将问题转发给 production_agent 的 SSE 聊天接口：
 *   POST {AGENT_API_BASE}/api/chat/:sessionId
 * 该接口以 SSE 流式返回 text_delta 事件，本模块负责：
 *   1. 解析 SSE 流，聚合所有 text_delta 的 delta 片段
 *   2. 超时 / 错误处理
 *   3. 返回最终的完整回答文本
 */

import { createParser, type EventSourceParser } from "eventsource-parser";
import { config, extractUserid } from "./config.js";

export interface AskOptions {
  question: string;
  /** 提问者 userid（来自企微请求头） */
  userid?: string;
  /** 可选自定义会话 id；不传则每次新建随机会话 */
  sessionId?: string;
}

export interface AskResult {
  answer: string;
  sessionId: string;
  /** 是否命中超时（超时则返回已聚合的部分文本） */
  timedOut: boolean;
  error?: string;
}

function randomSessionId(): string {
  return "mcp-" + Math.random().toString(36).slice(2, 12);
}

/**
 * 向 production_agent 提问并聚合回答。
 * 复用 querystring 解析 SSE，兼容标准 EventSource 文本。
 */
export async function askAgent(opts: AskOptions): Promise<AskResult> {
  const sessionId = opts.sessionId || randomSessionId();
  const url = `${config.agentApiBase}/api/chat/${encodeURIComponent(sessionId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.agentApiTimeoutMs);

  const userid = opts.userid || "anonymous";

  // 转发给 agent 的 body（production_agent 支持 text + user）
  const body = JSON.stringify({
    text: opts.question,
    user: { userId: userid, role: "supervisor", baseId: null },
  });

  let parser: EventSourceParser;
  const chunks: string[] = [];
  let done = false;
  let timedOut = false;
  let remoteError: string | undefined;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      clearTimeout(timer);
      const msg = await resp.text().catch(() => "");
      return {
        answer: "",
        sessionId,
        timedOut: false,
        error: `Agent 返回错误状态码 ${resp.status}${msg ? ": " + msg : ""}`,
      };
    }

    parser = createParser({
      onEvent(event) {
        if (event.event === "text_delta") {
          try {
            const data = JSON.parse(event.data);
            if (typeof data.delta === "string") chunks.push(data.delta);
          } catch {
            /* 忽略无法解析的片段 */
          }
        } else if (event.event === "done") {
          done = true;
        } else if (event.event === "error") {
          try {
            const data = JSON.parse(event.data);
            remoteError = data.message || "Agent 执行错误";
          } catch {
            remoteError = "Agent 执行错误";
          }
        }
      },
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      parser.feed(decoder.decode(value, { stream: true }));
      if (done) break;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      timedOut = true;
    } else {
      clearTimeout(timer);
      return {
        answer: "",
        sessionId,
        timedOut: false,
        error: `请求 Agent 失败: ${(err as Error).message}`,
      };
    }
  } finally {
    clearTimeout(timer);
  }

  const answer = chunks.join("").trim();

  if (remoteError && !answer) {
    return { answer: "", sessionId, timedOut, error: remoteError };
  }

  return {
    answer: answer || (timedOut ? "（回答超时，未获取到完整结果）" : "（未获取到回答内容）"),
    sessionId,
    timedOut,
    error: remoteError,
  };
}
