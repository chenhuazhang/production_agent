import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { SessionProvider } from "@/lib/sessionContext";

export const metadata: Metadata = {
  title: "中试 AI 助手",
  description: "中试基地智能管理平台 - 订单进度查询与产能负荷分析",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body
        className="h-full flex"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif' }}
      >
        <SessionProvider>
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
