"use client";

import { useState, useCallback, useEffect } from "react";
import { MessageList, Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { sendChatMessageStream } from "@/lib/ai-client";
import { useSession } from "@/lib/sessionContext";
import { fetchSessionHistory } from "@/lib/sessions";
import { Search, BarChart3, MapPin, CalendarClock } from "lucide-react";

const SUGGESTIONS = [
  { icon: Search, label: "查询订单生产进度", text: "查询订单生产进度" },
  { icon: BarChart3, label: "分析各基地产能负荷", text: "分析各基地产能负荷" },
  { icon: MapPin, label: "推荐最优下单基地", text: "推荐最优下单基地" },
  { icon: CalendarClock, label: "估算新订单交期", text: "估算新订单交期" },
];

export function ChatPanel() {
  const { sessionId, refresh: refreshSessionList } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState<string | null>(null);

  // 建议卡片点击 → 填入输入框
  const [fillValue, setFillValue] = useState<string | null>(null);
  const handleFillConsumed = useCallback(() => setFillValue(null), []);

  // ── 初次加载 + sessionId 变更时加载历史 ──
  useEffect(() => {
    if (!sessionId) return;
    if (historyLoaded === sessionId) return;

    if (sessionId.startsWith("sess-")) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content:
            "你好！我是中试AI助手。我可以帮你查询生产进度、分析产能负荷、推荐下单基地和估算交期。请在下方输入你的需求，或点击快捷指令开始。",
        },
      ]);
      setHistoryLoaded(sessionId);
      return;
    }

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

  // 是否显示建议卡片：只有欢迎消息时显示
  const showSuggestions = messages.length === 1 && messages[0].id === "welcome";

  return (
    <div className="flex flex-col h-full">
      <MessageList messages={messages} />

      {/* 建议快捷指令 */}
      {showSuggestions && (
        <div className="flex-shrink-0 px-4 pb-2 max-w-3xl mx-auto w-full">
          <p className="text-xs font-medium text-[#8a8599] mb-2.5 text-center">试试这些指令</p>
          <div className="grid grid-cols-2 gap-2">
            {SUGGESTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => setFillValue(item.text)}
                  disabled={isLoading}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-[#e8e4dd] bg-white hover:bg-[#f5f2ed] hover:border-[#d4c9e8] transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-7 h-7 rounded-lg bg-[#f0ebf7] flex items-center justify-center shrink-0">
                    <Icon className="h-3.5 w-3.5 text-[#8b7fc7]" />
                  </div>
                  <span className="text-sm text-[#4a4a5a]">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <MessageInput
        onSend={handleSend}
        disabled={isLoading}
        fillValue={fillValue}
        onFillConsumed={handleFillConsumed}
      />
    </div>
  );
}
