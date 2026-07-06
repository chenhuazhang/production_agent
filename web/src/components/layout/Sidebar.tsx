"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, BarChart3, Settings, Home, LayoutDashboard, Plus, Clock, Loader2, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/lib/sessionContext";

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
  const { sessionId, sessionList, loading, mounted, switchSession, newSession, deleteSession } = useSession();

  return (
    <aside className="w-60 bg-gray-900 text-white flex flex-col h-full">
      {/* Logo */}
      <div className="p-4">
        <h1 className="text-lg font-bold">中试 AI 助手</h1>
        <p className="text-xs text-gray-400 mt-1">Production Agent</p>
      </div>

      {/* 新建对话 */}
      <div className="px-3 pb-2">
        <button
          onClick={mounted ? () => { newSession(); router.push("/chat"); } : undefined}
          disabled={!mounted}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          新建对话
        </button>
      </div>

      <Separator className="bg-gray-700" />

      {/* 导航 */}
      <nav className="p-2 space-y-1">
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
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Separator className="bg-gray-700" />

      {/* 对话历史 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          对话历史
        </div>
        <ScrollArea className="flex-1 px-2 pb-2">
          <div className="space-y-0.5">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              </div>
            ) : sessionList.length === 0 ? (
              <p className="text-xs text-gray-500 px-3 py-2">暂无对话记录</p>
            ) : (
              sessionList.map((s) => (
                <div
                  key={s.id}
                  className="group relative"
                >
                  <button
                    onClick={mounted ? () => { switchSession(s.id); router.push("/chat"); } : undefined}
                    disabled={!mounted}
                    className={cn(
                      "w-full text-left pl-3 pr-8 py-2 rounded-md text-xs transition-colors truncate block",
                      s.id === sessionId
                        ? "bg-blue-600 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white",
                    )}
                    title={s.firstMessage}
                  >
                    {s.name}
                  </button>
                  <button
                    onClick={mounted ? (e) => { e.stopPropagation(); if (confirm("确定删除这条对话记录？")) deleteSession(s.id); } : undefined}
                    disabled={!mounted}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="p-4 text-xs text-gray-500">v0.2.0</div>
    </aside>
  );
}
