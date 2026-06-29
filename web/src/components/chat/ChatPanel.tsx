"use client";

import { useState, useCallback, useRef } from "react";
import { MessageList, Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { sendChatMessageStream } from "@/lib/ai-client";

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "你好！我是中试AI助手。我可以帮你：\n\n" +
        "1. 查询订单生产进度\n" +
        "2. 分析各基地产能负荷\n" +
        "3. 推荐最优下单基地\n" +
        "4. 估算新订单交期\n\n" +
        "请告诉我你需要什么帮助？",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const sessionIdRef = useRef<string>(`sess-${Date.now()}`);

  const handleSend = useCallback(
    async (content: string) => {
      // 用户消息
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      // 流式占位
      const loadingId = `loading-${Date.now()}`;
      const toolResults: NonNullable<Message["toolResults"]> = [];
      setMessages((prev) => [
        ...prev,
        { id: loadingId, role: "assistant", content: "", isLoading: true, toolResults },
      ]);

      const appendDelta = (delta: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? { ...m, content: m.content + delta, isLoading: true }
              : m,
          ),
        );
      };
      const addTool = (name: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? {
                  ...m,
                  toolResults: [
                    ...(m.toolResults ?? []),
                    { tool_call_id: `tc-${Date.now()}-${name}`, name, result: { result: "执行中…" } },
                  ],
                }
              : m,
          ),
        );
      };
      const finishTool = (name: string, isError: boolean, result: unknown) => {
        // result 形如 AgentToolResult { content: [{type:"text", text}], details }
        const details = (result as { details?: unknown } | null)?.details ?? result;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== loadingId || !m.toolResults) return m;
            const idx = [...m.toolResults].reverse().findIndex((t) => t.name === name);
            if (idx === -1) return m;
            const realIdx = m.toolResults.length - 1 - idx;
            const next = [...m.toolResults];
            next[realIdx] = {
              ...next[realIdx],
              result: {
                result: details,
                success: !isError,
                error: isError ? "工具执行失败" : undefined,
              },
            };
            return { ...m, toolResults: next };
          }),
        );
      };

      try {
        await sendChatMessageStream(
          sessionIdRef.current,
          { message: content },
          {
            onTextDelta: appendDelta,
            onToolStart: (name) => addTool(name),
            onToolEnd: (name, isError, result) => finishTool(name, isError, result),
            onDone: () => {
              setMessages((prev) =>
                prev.map((m) => (m.id === loadingId ? { ...m, isLoading: false } : m)),
              );
            },
            onError: (msg) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === loadingId
                    ? {
                        ...m,
                        content: m.content || `抱歉，AI服务暂时无法响应。\n\n错误信息：${msg}`,
                        isLoading: false,
                      }
                    : m,
                ),
              );
            },
          },
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "未知错误";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? {
                  ...m,
                  content: m.content || `抱歉，AI服务暂时无法响应。\n\n错误信息：${errMsg}`,
                  isLoading: false,
                }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <MessageList messages={messages} />
      <MessageInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
