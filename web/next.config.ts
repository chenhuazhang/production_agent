import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://172.19.155.196:3000",
    "http://172.19.154.32:3000",
    "http://172.19.152.86:3000",
  ],
  // 浏览器端 /api/chat 和 /api/sessions 转发到 agent 容器
  // /api/dashboard、/api/bases、/api/capacity 由 Next.js 自己处理
  async rewrites() {
    return [
      {
        source: "/api/chat/:path*",
        destination: `${process.env.AI_API_URL || "http://localhost:8000"}/api/chat/:path*`,
      },
      {
        source: "/api/sessions/:path*",
        destination: `${process.env.AI_API_URL || "http://localhost:8000"}/api/sessions/:path*`,
      },
    ];
  },
};

export default nextConfig;
