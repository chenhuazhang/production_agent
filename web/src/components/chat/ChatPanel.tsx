"use client";

import { useState, useCallback, useEffect } from "react";
import { MessageList, Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { sendChatMessageStream } from "@/lib/ai-client";
import { useSession } from "@/lib/sessionContext";
import { fetchSessionHistory } from "@/lib/sessions";

export function ChatPanel() {
  const { sessionId, refresh: refreshSessionList } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState<string | null>(null);

  // ── 初次加载 + sessionId 变更时加载历史 ──
  useEffect(() => {
    if (!sessionId) return;
    if (historyLoaded === sessionId) return;

    // 新会话（以 sess- 开头）→ 显示欢迎消息
    if (sessionId.startsWith("sess-")) {
      setMessages([
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
      setHistoryLoaded(sessionId);
      return;
    }

    // 历史会话 → 从 API 加载
    fetchSessionHistory(sessionId).then((hist) => {
      if (hist && hist.messages.length) {
        setMessages(
          hist.messages.map((m) => ({
            id: m.id,
            role: m.role as Message["role"],
            content: m.content,
          })),
        );
      } else {
        setMessages([
          { id: "welcome", role: "assistant", content: "你好！我是中试AI助手。有什么可以帮你的？" },
        ]);
      }
      setHistoryLoaded(sessionId);
    }).catch(() => setHistoryLoaded(sessionId));
  }, [sessionId, historyLoaded]);

  // ── 发送消息 ──
  const handleSend = useCallback(
    async (content: string) => {
      const userMsg: Message = { id: `user-${Date.now()}`, role: "user", content };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      let thinkingText = "";
      const loadingId = `loading-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: loadingId, role: "assistant", content: "", thinking: "", isLoading: true },
      ]);

      const appendThinking = (delta: string) => {
        thinkingText += delta;
        setMessages((prev) =>
          prev.map((m) => (m.id === loadingId ? { ...m, thinking: thinkingText } : m)),
        );
      };
      const appendDelta = (delta: string) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === loadingId ? { ...m, content: m.content + delta } : m)),
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
        const details = (result as { details?: unknown } | null)?.details ?? result;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== loadingId || !m.toolResults) return m;
            const idx = [...m.toolResults].reverse().findIndex((t) => t.name === name);
            if (idx === -1) return m;
            const realIdx = m.toolResults.length - 1 - idx;
            const next = [...m.toolResults];
            next[realIdx] = { ...next[realIdx], result: { result: details, success: !isError, error: isError ? "工具执行失败" : undefined } };
            return { ...m, toolResults: next };
          }),
        );
      };

      try {
        await sendChatMessageStream(sessionId, { message: content }, {
          onTextDelta: appendDelta,
          onThinkingDelta: appendThinking,
          onToolStart: addTool,
          onToolEnd: finishTool,
          onDone: () => {
            setMessages((prev) => prev.map((m) => (m.id === loadingId ? { ...m, isLoading: false } : m)));
            refreshSessionList();
          },
          onError: (msg) => setMessages((prev) => prev.map((m) => (m.id === loadingId ? { ...m, content: m.content || `错误：${msg}`, isLoading: false } : m))),
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "未知错误";
        setMessages((prev) => prev.map((m) => (m.id === loadingId ? { ...m, content: m.content || `错误：${errMsg}`, isLoading: false } : m)));
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, refreshSessionList],
  );

  return (
    <div className="flex flex-col h-full">
      <MessageList messages={messages} />
      <MessageInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
