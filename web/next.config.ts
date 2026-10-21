import type { NextConfig } from "next";

const AI_API_URL =
  process.env.AI_API_URL || process.env.PYTHON_API_URL || "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Chat SSE 流式接口 → server (8001)
      {
        source: "/api/chat/:path*",
        destination: `${AI_API_URL}/api/chat/:path*`,
      },
      // 会话管理接口 → server (8001)
      {
        source: "/api/sessions/:path*",
        destination: `${AI_API_URL}/api/sessions/:path*`,
      },
    ];
  },
};

export default nextConfig;
