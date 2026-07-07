"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 居中确认弹窗（替代浏览器 confirm()）
 * 带遮罩层，点击外部或按 Escape 可关闭
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* 弹窗本体 */}
      <div
        ref={dialogRef}
        className="relative bg-[#f5f0e1] rounded-xl shadow-2xl w-[380px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <span className="text-base font-bold text-gray-900">{title}</span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 分隔线 */}
        <div className="mx-5 border-t border-gray-300/60" />

        {/* 内容 */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-800 leading-relaxed">{message}</p>
        </div>

        {/* 按钮区 */}
        <div className="flex items-center justify-end gap-3 px-5 pb-5">
          <button
            onClick={onCancel}
            className="px-5 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onCancel(); }}
            className="px-5 py-2 text-sm rounded-lg bg-purple-700 text-white hover:bg-purple-800 transition-colors cursor-pointer font-medium"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
