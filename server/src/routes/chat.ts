/**
 * Chat API Route
 *
 * POST /api/chat/:sessionId
 * - 接收用户消息 { text }
 * - 返回 SSE 流式响应，事件类型：text_delta / tool_start / tool_end / done / error
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionStore } from "../services/sessionStore";
import { createLogger } from "../services/logger";
import { runWithUser, type UserContext } from "pi-agent";
import { ExecutionTracer } from "../services/executionTracer";

const logger = createLogger("chat");
const tracer = new ExecutionTracer();

interface ChatRequest {
  text: string;
  /** 用户身份（从 CRM token 解析后传入） */
  user?: UserContext;
}

/** 默认匿名用户（未接入 CRM 鉴权时使用，无限制） */
const ANON_USER: UserContext = {
  userId: "anonymous",
  role: "supervisor",
  baseId: null,
};

type RawEvent = Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];

function transformAgentEvent(raw: RawEvent): { event: string; data: object } | null {
  switch (raw.type) {
    case "message_update": {
      if (raw.assistantMessageEvent.type === "text_delta") {
        return { event: "text_delta", data: { delta: raw.assistantMessageEvent.delta } };
      }
      if (raw.assistantMessageEvent.type === "thinking_delta") {
        return { event: "thinking_delta", data: { delta: raw.assistantMessageEvent.delta } };
      }
      return null;
    }
    case "tool_execution_start":
      return { event: "tool_start", data: { toolName: raw.toolName, args: raw.args } };
    case "tool_execution_end":
      return {
        event: "tool_end",
        data: { toolName: raw.toolName, isError: raw.isError, result: raw.result },
      };
    case "agent_end":
      return { event: "done", data: {} };
    case "message_end": {
      const msg = raw.message;
      if ("stopReason" in msg && msg.stopReason === "error") {
        return { event: "error", data: { message: msg.errorMessage ?? "Unknown error" } };
      }
      return null;
    }
    default:
      return null;
  }
}

export function chatRoute(store: SessionStore) {
  const app = new Hono();

  app.post("/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const startTime = Date.now();

    let body: ChatRequest;
    try {
      body = await c.req.json<ChatRequest>();
    } catch {
      logger.warn("Invalid JSON body", { sessionId });
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (!body.text || typeof body.text !== "string" || body.text.trim() === "") {
      logger.warn("Missing or empty text field", { sessionId });
      return c.json({ error: "Text is required" }, 400);
    }

    const text = body.text.trim();
    logger.request(sessionId, text);

    if (store.isBusy(sessionId)) {
      logger.warn("Session busy, request rejected", { sessionId });
      return c.json({ error: "Session is busy" }, 429);
    }

    // 会话创建可能因配置错误（缺 API Key / 模型不可用）失败，
    // 此时返回带消息的 JSON 而非裸 500，便于前端展示。
    let entry;
    try {
      entry = await store.getOrCreate(sessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Session creation failed";
      logger.error("Session creation failed", { sessionId, error: msg });
      return c.json({ error: msg }, 500);
    }
    store.setBusy(sessionId, true);

    const user = body.user ?? ANON_USER;

    return streamSSE(c, async (stream) => {
      let unsubscribe: (() => void) | null = null;
      const traceId = tracer.start(sessionId, text, user);
      try {
        unsubscribe = entry.session.subscribe((raw) => {
          // 喂给 tracer（结构化日志持久化）
          tracer.record(raw, traceId);

          // 喂给 SSE（实时推送前端）
          const sse = transformAgentEvent(raw);
          if (sse) {
            stream.writeSSE({ event: sse.event, data: JSON.stringify(sse.data) });
            logger.sseEvent(sessionId, sse.event);
          }
        });

        logger.info("Executing prompt", { sessionId, textLength: text.length });
        // 👇 权限上下文：工具执行时通过 ALS 读取用户身份
        await runWithUser(user, () => entry.session.prompt(text));
        tracer.finish(traceId);
        logger.response(sessionId, Date.now() - startTime);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        tracer.error(traceId, msg);
        logger.error("Prompt execution failed", { sessionId, error: msg });
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: msg }) });
      } finally {
        if (unsubscribe) unsubscribe();
        store.setBusy(sessionId, false);
        logger.debug("Session released", { sessionId });
      }
    });
  });

  return app;
}
