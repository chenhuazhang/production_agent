"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, BarChart3, Settings, Home } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/chat", label: "智能对话", icon: MessageSquare },
  { href: "/capacity", label: "负荷看板", icon: BarChart3 },
  { href: "/bases", label: "基地管理", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-gray-900 text-white flex flex-col">
      <div className="p-4">
        <h1 className="text-lg font-bold">中试 AI 助手</h1>
        <p className="text-xs text-gray-400 mt-1">Production Agent</p>
      </div>
      <Separator className="bg-gray-700" />
      <nav className="flex-1 p-2 space-y-1">
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
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 text-xs text-gray-500">
        v0.1.0
      </div>
    </aside>
  );
}
