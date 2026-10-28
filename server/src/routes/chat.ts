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
import { runTurn, type TurnEvent, type UserContext } from "pi-agent";
import { ExecutionTracer } from "../services/executionTracer";
import { REPLY_FOOTER } from "../services/replyFooter";

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
/** TurnEvent → 本项目 SSE 事件（协议见 README） */
function toSse(ev: TurnEvent): { event: string; data: object } | null {
  switch (ev.type) {
    case "text":
      return { event: "text_delta", data: { delta: ev.delta } };
    case "thinking":
      return { event: "thinking_delta", data: { delta: ev.delta } };
    case "tool_start":
      return { event: "tool_start", data: { toolName: ev.toolName, args: ev.args } };
    case "tool_end":
      return {
        event: "tool_end",
        data: { toolName: ev.toolName, isError: ev.isError, result: ev.result },
      };
    case "done":
      return { event: "done", data: {} };
    case "error":
      // 错误统一由 result.status 发送，避免与降级执行器的过滤逻辑打架
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

    // 返回持久化会话 id：首条消息后前端用它替换 sess- 临时 id，避免会话分裂
    const persistedId = entry.session.sessionManager.getSessionId();
    if (persistedId) c.header("X-Session-Id", persistedId);

    const user = body.user ?? ANON_USER;

    return streamSSE(c, async (stream) => {
      const traceId = tracer.start(sessionId, text, user);
      try {
        logger.info("Executing prompt", { sessionId, textLength: text.length });
        // 一回合的唯一实现：模型降级、页脚、事件翻译都在 runTurn 内完成
        const result = await runTurn({
          session: entry.session,
          text,
          user,
          modelChain: entry.modelChain,
          footer: REPLY_FOOTER,
          onEvent: (ev) => {
            tracer.record(ev, traceId);
            const sse = toSse(ev);
            if (!sse) return;
            stream.writeSSE({ event: sse.event, data: JSON.stringify(sse.data) });
            logger.sseEvent(sessionId, sse.event);
          },
        });

        if (result.status === "error") {
          await tracer.error(traceId, result.message);
          logger.error("Prompt execution failed", { sessionId, error: result.message });
          await stream.writeSSE({ event: "error", data: JSON.stringify({ message: result.message }) });
        } else {
          await tracer.finish(traceId);
          logger.response(sessionId, Date.now() - startTime);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        await tracer.error(traceId, msg);
        logger.error("Prompt execution failed", { sessionId, error: msg });
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: msg }) });
      } finally {
        store.setBusy(sessionId, false);
        logger.debug("Session released", { sessionId });
      }
    });
  });

  return app;
}
