/**
 * OpenAI 兼容同步接口
 *
 * POST /v1/chat/completions
 * - 接收标准 OpenAI 格式请求 { model, messages, stream? }
 * - 内部调用 pi_agent（聚合 SSE 流为最终文本）
 * - 返回标准 OpenAI chat.completion JSON
 *
 * 用途：让 MaxKB 把 production_agent 当作"OpenAI 兼容模型"接入。
 * - 无状态：每次请求用临时 sessionId，跑完即销毁；对话历史由 MaxKB 通过 messages 传入。
 * - 鉴权：依赖外层 index.ts 的 Bearer API Key 中间件。
 */

import { Hono } from "hono";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionStore } from "../services/sessionStore";

type AnyModel = Model<any>;
import { createLogger } from "../services/logger";
import { runTurn, resolveScopeByModel, type UserContext } from "pi-agent";
import { REPLY_FOOTER, stripReplyFooter } from "../services/replyFooter";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const logger = createLogger("openai-compat");

/** 请求落盘日志（排查 MaxKB 模型名路由用，含收到的 model 与解析出的业务范围） */
const REQ_LOG = path.resolve(process.cwd(), "data", "logs", "maxkb-requests.jsonl");
function logRequest(entry: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(REQ_LOG), { recursive: true });
    appendFileSync(REQ_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // 日志失败不影响请求
  }
}

/** MaxKB 调用时无企微用户上下文，用 supervisor 角色放行全部工具 */
const MAXKB_USER: UserContext = {
  userId: "maxkb",
  role: "supervisor",
  baseId: null,
};

/** /v1/models 对外公布的虚拟模型（MaxKB 模型配置里的"模型名"） */
const VIRTUAL_MODELS = ["production-agent", "production-agent-gz", "production-agent-main"];

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string }>;
}

interface OpenAIRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
}

/** 把 OpenAI 的 content（可能是字符串或多模态数组）统一提取成纯文本 */
function extractText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text as string)
      .join("");
  }
  return String(content ?? "");
}

/**
 * 把 MaxKB 传入的 messages 历史拼成 pi_agent 可消费的 prompt 字符串。
 * - 忽略 system 消息（pi_agent 自带 AGENTS.md 定义的 system prompt）
 * - 拼接 user/assistant 历史，最后一轮 user 作为当前问题
 */
function buildPromptFromMessages(messages: ChatMessage[]): string {
  const conversation = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  if (conversation.length === 0) {
    throw new Error("messages 中没有 user 消息");
  }
  if (conversation.length === 1) {
    return extractText(conversation[0].content);
  }
  const history = conversation
    .slice(0, -1)
    .map((m) => {
      const text = extractText(m.content);
      // 剥掉历史助手消息末尾的反馈页脚，避免模型把页脚当固定语气复述（导致重复页脚）
      const clean = m.role === "assistant" ? stripReplyFooter(text) : text;
      return `${m.role === "user" ? "用户" : "助手"}：${clean}`;
    })
    .join("\n\n");
  const last = conversation[conversation.length - 1];
  return `${history}\n\n用户：${extractText(last.content)}`;
}

/**
 * 同步执行 pi_agent prompt，聚合事件为最终文本。
 * - 通过 runTurn 执行（含模型额度降级与页脚）
 * - 累积 text_delta 到 buffer / 记录 toolEvents
 * - 成功 resolve；任一模型最终失败（含降级链全部用尽）reject
 */
async function runPromptSync(
  session: AgentSession,
  prompt: string,
  user: UserContext,
  modelChain: AnyModel[],
): Promise<{ content: string; toolEvents: Array<Record<string, unknown>> }> {
  let content = "";
  const toolEvents: Array<Record<string, unknown>> = [];

  // 同步接口同样走 runTurn：页脚与降级只有一份实现
  const result = await runTurn({
    session,
    text: prompt,
    user,
    modelChain,
    footer: REPLY_FOOTER,
    onEvent: (ev) => {
      switch (ev.type) {
        case "text":
          content += ev.delta;
          break;
        case "tool_start":
          toolEvents.push({ phase: "start", tool: ev.toolName, args: ev.args });
          break;
        case "tool_end":
          toolEvents.push({
            phase: "end",
            tool: ev.toolName,
            isError: ev.isError,
            result: ev.result,
          });
          break;
        default:
          break;
      }
    },
  });

  if (result.status === "error") throw new Error(result.message);
  return { content, toolEvents };
}

/**
 * 流式执行 pi_agent prompt，按 OpenAI SSE 协议推送 chat.completion.chunk 事件。
 *
 * SSE 格式：
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n
 *   ...
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n
 *   data: [DONE]\n\n
 *
 * 错误时推送一个含错误信息的 chunk 后再发 [DONE]。
 */
function runPromptStream(
  session: AgentSession,
  prompt: string,
  user: UserContext,
  model: string,
  modelChain: AnyModel[],
  onDone?: () => void,
): ReadableStream {
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const send = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const sendDone = () => encoder.encode("data: [DONE]\n\n");

  let firstDelta = true;
  let closed = false;

  return new ReadableStream({
    start(controller) {
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { onDone?.(); } catch { /* noop */ }
        try { controller.close(); } catch { /* noop */ }
      };
      const emitChunk = (delta: Record<string, unknown>, finish_reason: null | "stop") =>
        controller.enqueue(
          send({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta, finish_reason }],
          }),
        );
      const emitError = (message: string) => {
        if (closed) return;
        emitChunk({ content: `[error] ${message}` }, "stop");
        controller.enqueue(sendDone());
        safeClose();
      };

      // runTurn 负责页脚与降级；这里只把 TurnEvent 编码成 OpenAI chunk
      runTurn({
        session,
        text: prompt,
        user,
        modelChain,
        footer: REPLY_FOOTER,
        onEvent: (ev) => {
          if (closed) return;
          switch (ev.type) {
            case "text": {
              const delta: Record<string, unknown> = firstDelta
                ? { role: "assistant", content: ev.delta }
                : { content: ev.delta };
              firstDelta = false;
              emitChunk(delta, null);
              break;
            }
            case "done":
              emitChunk({}, "stop");
              controller.enqueue(sendDone());
              safeClose();
              break;
            default:
              break;
          }
        },
      })
        .then((result) => {
          if (result.status === "error") emitError(result.message);
        })
        .catch((err) => emitError(err instanceof Error ? err.message : String(err)));
    },
    cancel() {
      if (closed) return;
      closed = true;
      try { onDone?.(); } catch { /* noop */ }
    },
  });
}

export function openaiCompatRoute(store: SessionStore) {
  const app = new Hono();

  // GET /v1/models — 返回虚拟模型列表，便于 MaxKB 探测。
  // production-agent        = 全部业务
  // production-agent-gz     = 仅 广州送样&小订单
  // production-agent-main   = 其余 4 类（广州工艺实验 / 小试 / 上海工艺实验 / OA辅助单）
  app.get("/models", (c) =>
    c.json({
      object: "list",
      data: VIRTUAL_MODELS.map((id) => ({
        id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "pilot-workshop",
      })),
    }),
  );

  app.post("/chat/completions", async (c) => {
    let body: OpenAIRequest;
    try {
      body = await c.req.json<OpenAIRequest>();
    } catch {
      return c.json(
        { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
        400,
      );
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json(
        { error: { message: "messages is required", type: "invalid_request_error" } },
        400,
      );
    }

    // 调试：把 MaxKB 传来的完整 messages 打到日志里，便于排查
    logger.info("OpenAI compat raw messages", {
      messages: body.messages.map((m) => ({
        role: m.role,
        contentType: typeof m.content,
        contentPreview:
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : JSON.stringify(m.content).slice(0, 200),
      })),
    });

    let prompt: string;
    try {
      prompt = buildPromptFromMessages(body.messages);
    } catch (e) {
      return c.json(
        {
          error: {
            message: e instanceof Error ? e.message : "Invalid messages",
            type: "invalid_request_error",
          },
        },
        400,
      );
    }

    // 无状态：每次请求用临时 sessionId，跑完销毁
    const sessionId = `maxkb-${randomUUID()}`;
    const startTime = Date.now();
    const model = body.model || "production-agent";
    // 按模型名路由业务范围（企业微信机器人 A/B → MaxKB 应用 A/B → 不同模型名）
    const scope = resolveScopeByModel(model);
    const maxkbUser: UserContext = { ...MAXKB_USER, allowedBusinessTypes: scope.types };
    logger.info("OpenAI compat scope", { model, scope: scope.key, types: scope.types.join(",") });
    logRequest({ model, scope: scope.key, prompt: prompt.slice(0, 120) });

    let entry;
    try {
      entry = await store.getOrCreate(sessionId, scope.note ? { scopeNote: scope.note } : undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Session creation failed";
      logger.error("Session creation failed", { sessionId, error: msg });
      return c.json(
        { error: { message: msg, type: "server_error" } },
        500,
      );
    }

    logger.info("OpenAI compat request", {
      sessionId,
      stream: !!body.stream,
      promptLength: prompt.length,
      historyRounds: body.messages.length,
    });

    // ── 流式响应：MaxKB 默认用 stream=true 调用 ──
    if (body.stream) {
      const stream = runPromptStream(
        entry.session,
        prompt,
        maxkbUser,
        model,
        entry.modelChain,
        () => store.delete(sessionId),
      );
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── 同步响应 ──
    try {
      const { content, toolEvents } = await runPromptSync(
        entry.session,
        prompt,
        maxkbUser,
        entry.modelChain,
      );

      const response = {
        id: `chatcmpl-${randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: content || "(无回复)",
            },
            finish_reason: "stop",
          },
        ],
        // usage 未知，给 -1 让 MaxKB 不依赖计费信息
        usage: {
          prompt_tokens: -1,
          completion_tokens: -1,
          total_tokens: -1,
        },
      };

      logger.info("OpenAI compat response", {
        sessionId,
        duration: Date.now() - startTime,
        toolCount: toolEvents.length,
        contentLength: content.length,
      });

      return c.json(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error("Prompt execution failed", { sessionId, error: msg });
      return c.json(
        { error: { message: msg, type: "server_error" } },
        500,
      );
    } finally {
      // 释放临时 session，避免内存堆积
      store.delete(sessionId);
    }
  });

  return app;
}
