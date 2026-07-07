"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MessageSquare, BarChart3, Settings, Home, LayoutDashboard,
  Plus, Clock, Loader2, Trash2, Pin, Edit3,
  Check, X, ChevronDown, ChevronRight, LogOut, User, Sparkles,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useSession } from "@/lib/sessionContext";
import { useState, useRef, useEffect, useCallback } from "react";

const NAV_ITEMS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/chat", label: "智能对话", icon: MessageSquare },
  { href: "/dashboard", label: "执行看板", icon: LayoutDashboard },
  { href: "/capacity", label: "负荷看板", icon: BarChart3 },
  { href: "/bases", label: "基地管理", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sessionId, sessionList, loading, mounted, switchSession, newSession, deleteSession, renameSession, pinSession } = useSession();

  const [navExpanded, setNavExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) deleteSession(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, deleteSession]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  return (
    <aside className="w-60 bg-[#f0ede8] text-gray-900 flex flex-col h-full border-r border-[#e0dbd3]">
      {/* ── Logo ── */}
      <div className="p-4">
        <h1 className="text-lg font-bold text-gray-900">中试 AI 助手</h1>
        <p className="text-xs text-gray-500 mt-1">Production Agent</p>
      </div>

      {/* ── 新建对话 ── */}
      <div className="px-3 pb-2">
        <button
          onClick={mounted ? () => { newSession(); router.push("/chat"); } : undefined}
          disabled={!mounted}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-gray-800 bg-[#e6e0d5] transition-colors disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          新建对话
        </button>
      </div>

      <Separator className="bg-[#d8d3ca] mx-3 w-auto" />

      {/* ── 导航 (可折叠) ── */}
      <div className="pt-2">
        <button
          onClick={() => setNavExpanded(!navExpanded)}
          className="flex items-center gap-1.5 w-full px-4 py-1.5 text-xs text-gray-500 transition-colors"
        >
          {navExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          导航
        </button>
        {navExpanded && (
          <nav className="px-2 pb-1 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-[#e0d9cc] text-gray-900 font-medium"
                      : "text-gray-700",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      <Separator className="bg-[#d8d3ca] mx-3 w-auto" />

      {/* ── 对话历史 (可折叠) ── */}
      <div className="flex-1 flex flex-col min-h-0">
        <button
          onClick={() => setHistoryExpanded(!historyExpanded)}
          className="flex items-center gap-1.5 w-full px-4 py-1.5 text-xs text-gray-500"
        >
          {historyExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Clock className="h-3 w-3" />
          对话历史
        </button>
        {historyExpanded && (
          <div className="flex-1 px-2 pb-2 overflow-y-auto overflow-x-visible">
            <div className="space-y-0.5">
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                </div>
              ) : sessionList.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-2">暂无对话记录</p>
              ) : (
                sessionList.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={s.id === sessionId}
                    mounted={mounted}
                    onSelect={() => { switchSession(s.id); router.push("/chat"); }}
                    onDelete={() => setDeleteTarget(s.id)}
                    onRename={(newName) => renameSession(s.id, newName)}
                    onPin={(pinned) => pinSession(s.id, pinned)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 用户区 ── */}
      <div className="relative border-t border-[#d8d3ca]" ref={userMenuRef}>
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="flex items-center gap-2.5 w-full px-3 py-3 text-left"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
            J
          </div>
          <span className="text-sm text-gray-800 flex-1 truncate">Jiang</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-gray-500 transition-transform", userMenuOpen && "rotate-180")} />
        </button>

        {userMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-[#d8d3ca] rounded-lg shadow-xl py-1 z-50">
            <button
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-800 hover:bg-[#f5f2ed] transition-colors"
            >
              <User className="h-4 w-4 text-gray-500" />
              设置
            </button>
            <button
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除对话"
        message="确定删除这条对话记录？删除后无法恢复。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}

// ============================================================
// SessionItem
// ============================================================

function SessionItem({
  session,
  isActive,
  mounted,
  onSelect,
  onDelete,
  onRename,
  onPin,
}: {
  session: { id: string; name: string; firstMessage: string; pinned?: boolean };
  isActive: boolean;
  mounted: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => Promise<boolean>;
  onPin: (pinned: boolean) => Promise<boolean>;
}) {
  const [hover, setHover] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.name);

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.name) {
      await onRename(trimmed);
    }
    setRenaming(false);
    setRenameValue(session.name);
  };

  const handleRenameCancel = () => {
    setRenaming(false);
    setRenameValue(session.name);
  };

  return (
    <div
      className={cn(
        "relative flex items-center rounded-md transition-colors",
        !isActive && hover && "bg-[#e8e4dd]",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {renaming ? (
        <>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") handleRenameCancel();
            }}
            className="flex-1 bg-white text-gray-900 text-xs px-2 py-1 rounded outline-none border border-gray-400"
            maxLength={50}
          />
          <button onClick={handleRenameSubmit} className="shrink-0 p-1 ml-1 rounded text-green-500" title="确认">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleRenameCancel} className="shrink-0 p-1 rounded text-gray-400" title="取消">
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <button
            onClick={mounted ? onSelect : undefined}
            disabled={!mounted}
            className={cn(
              "flex-1 text-left pl-3 py-2 rounded-md text-xs truncate",
              isActive
                ? "bg-[#e0d9cc] text-gray-900 font-medium"
                : "text-gray-700",
            )}
            title={session.firstMessage}
          >
            {session.pinned && <Pin className="h-3 w-3 inline mr-1 text-yellow-400" />}
            {session.name}
          </button>

          {/* 三个操作按钮：hover 时显示，absolute 覆盖在文字上方 */}
          {hover && (
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pr-1.5 pl-4 bg-gradient-to-l from-[#e8e4dd] via-[#e8e4dd] to-transparent">
              <button
                onClick={(e) => { e.stopPropagation(); onPin(!session.pinned); }}
                disabled={!mounted}
                className="p-1 rounded text-gray-400 hover:text-yellow-500 transition-colors"
                title={session.pinned ? "取消置顶" : "置顶"}
              >
                <Pin className={cn("h-3.5 w-3.5", session.pinned && "fill-yellow-400 text-yellow-400")} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setRenaming(true); setRenameValue(session.name); }}
                disabled={!mounted}
                className="p-1 rounded text-gray-400 hover:text-gray-900 transition-colors"
                title="重命名"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                disabled={!mounted}
                className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
