"use client";

import { useState, useEffect, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** 外部填入的值（如建议卡片点击），填完后自动清空 */
  fillValue?: string | null;
  onFillConsumed?: () => void;
}

export function MessageInput({ onSend, disabled, fillValue, onFillConsumed }: MessageInputProps) {
  const [input, setInput] = useState("");

  // 当外部填入值变化时，更新输入框
  useEffect(() => {
    if (fillValue) {
      setInput(fillValue);
      onFillConsumed?.();
    }
  }, [fillValue, onFillConsumed]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 p-4 border-t border-[#e8e4dd] bg-[#faf8f5] max-w-3xl mx-auto w-full"
    >
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="输入消息... 例如：查询订单ZS-2026-001的进度"
        disabled={disabled}
        className="flex-1 bg-white border-[#d4c9e8] focus:border-[#8b7fc7] focus:ring-[#8b7fc7]/20"
      />
      <Button 
        type="submit" 
        disabled={disabled || !input.trim()} 
        size="icon"
        className="bg-[#8b7fc7] hover:bg-[#6b5f9e] text-white"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
