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
      <summary className="text-xs text-gray-400 cursor-pointer select-none flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
        思考过程{isLoading ? "…" : ""}
      </summary>
      <div className="mt-1.5 p-2.5 bg-gray-50 rounded border border-gray-200 text-xs text-gray-500 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
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
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {msg.isLoading ? (
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
              ) : (
                <>
                  {msg.thinking && (
                    <ThinkingBox text={msg.thinking} isLoading={!!msg.isLoading} />
                  )}
                  <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  {msg.toolResults?.map((tr) => (
                    <ToolResultCard key={tr.tool_call_id} toolResult={tr as never} />
                  ))}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
