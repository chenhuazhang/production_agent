"use client";

import { useRef, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToolResultCard } from "./ToolResultCard";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** 模型的内部思考链（reasoning tokens），可折叠展示 */
  thinking?: string;
  toolResults?: Array<{
    tool_call_id: string;
    name: string;
    result: unknown;
  }>;
  isLoading?: boolean;
}

/** 折叠式思考框：在 assistant 消息的 content 上方展示 */
function ThinkingBox({ text, isLoading }: { text: string; isLoading: boolean }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mb-2"
    >
      <summary className="text-xs text-[#8a8599] cursor-pointer select-none flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-[#8b7fc7]" />
        思考过程{isLoading ? "…" : ""}
      </summary>
      <div className="mt-1.5 p-2.5 bg-[#f5f2ed] rounded border border-[#e8e4dd] text-xs text-[#6b6b7b] whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
        {text}
      </div>
    </details>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4 max-w-3xl mx-auto">
        {messages.map((msg) => {
          // 流式渲染：只要已有思考/正文/工具卡片到达就实时展示，
          // 加载圆点仅在「加载中且还没收到任何内容」时显示（否则用户会一直盯着圆点等整段返回）
          const hasStreamed =
            !!msg.content || !!msg.thinking || (!!msg.toolResults && msg.toolResults.length > 0);
          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                  msg.role === "user"
                    ? "bg-[#8b7fc7] text-white"
                    : "bg-[#f5f2ed] text-[#1a1a2e] border border-[#e8e4dd]"
                }`}
              >
                {msg.isLoading && !hasStreamed ? (
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-[#b5b0c4] rounded-full animate-bounce" />
                    <span
                      className="w-2 h-2 bg-[#b5b0c4] rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    />
                    <span
                      className="w-2 h-2 bg-[#b5b0c4] rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    />
                  </div>
                ) : (
                  <>
                    {msg.thinking && (
                      <ThinkingBox text={msg.thinking} isLoading={!!msg.isLoading} />
                    )}
                    {msg.content && (
                      <div className="whitespace-pre-wrap text-sm">
                        {msg.content}
                        {msg.isLoading && (
                          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[#8b7fc7]/60 rounded-sm animate-pulse align-[-2px]" />
                        )}
                      </div>
                    )}
                    {msg.toolResults?.map((tr) => (
                      <ToolResultCard key={tr.tool_call_id} toolResult={tr as never} />
                    ))}
                    {msg.isLoading && !msg.content && msg.toolResults && msg.toolResults.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <span className="w-1.5 h-1.5 bg-[#b5b0c4] rounded-full animate-bounce" />
                        <span
                          className="w-1.5 h-1.5 bg-[#b5b0c4] rounded-full animate-bounce"
                          style={{ animationDelay: "0.12s" }}
                        />
                        <span
                          className="w-1.5 h-1.5 bg-[#b5b0c4] rounded-full animate-bounce"
                          style={{ animationDelay: "0.24s" }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
