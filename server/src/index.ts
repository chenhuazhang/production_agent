/**
 * Server Entry Point
 *
 * Hono 服务器：
 * - 加载 pi_agent/.env
 * - Chat API 路由（SSE）
 * - Session 管理（30 分钟过期清理）
 * - OpenAI 兼容接口（/v1/*，供 MaxKB 接入）
 * - port 8001（兼容 web 端 PYTHON_API_URL 默认值）
 */

import { config } from "dotenv";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { chatRoute } from "./routes/chat";
import { sessionsRoute } from "./routes/sessions";
import { openaiCompatRoute } from "./routes/openai_compat";
import { openApiRoute, logOpenApiEvent } from "./routes/open_api";
import { SessionStore, type SessionCreateOptions } from "./services/sessionStore";
import { createLogger } from "./services/logger";
import { createSession } from "pi-agent";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "node:fs";

// 相对于本脚本位置解析到 pi_agent/.env（不受 cwd 影响）
// server/src/index.ts → server/ (.. .. ) → production_agent/ (.. ) → pi_agent/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", "pi_agent", ".env");
config({ path: ENV_PATH });

const logger = createLogger("main");

const PORT = Number(process.env.PORT) || 8001;

// 固定 agent 工作目录：项目根目录（pi_agent 从 cwd 读 AGENTS.md 等资源）
// 不依赖 server 启动时的 cwd，避免从不同子目录启动导致 session 目录分裂
const AGENT_CWD = join(__dirname, "..", "..");
mkdirSync(AGENT_CWD, { recursive: true });

// 将 pi-agent 的配置/会话目录改到项目目录下，避免 C:\Users\<user>\.pi 权限问题
// （Windows Defender 控制文件夹访问等安全策略可能阻止 server 进程在用户目录写入）
process.env.PI_CODING_AGENT_DIR = join(AGENT_CWD, ".pi", "agent");

async function createAgentSession(sessionFile?: string, opts?: SessionCreateOptions) {
  const { session, modelChain, dispose } = await createSession({
    cwd: AGENT_CWD,
    ...(sessionFile ? { sessionFile } : {}),
    ...(opts?.scopeNote ? { scopeNote: opts.scopeNote } : {}),
  });
  return { session, modelChain, dispose };
}

async function main() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  const sessionStore = new SessionStore(createAgentSession);

  setInterval(() => {
    sessionStore.cleanup();
    logger.debug("Session cleanup", { activeSessions: sessionStore.size });
  }, 5 * 60 * 1000);

  app.route("/api/chat", chatRoute(sessionStore));
  app.route("/api/sessions", sessionsRoute());

  // OpenAI 兼容同步接口（给 MaxKB 调用）：POST /v1/chat/completions
  // 用 SYNC_API_KEY 环境变量做 Bearer 鉴权；未配置时放行但打警告（仅开发用）
  const SYNC_API_KEY = process.env.SYNC_API_KEY;
  if (SYNC_API_KEY) {
    app.use("/v1/*", async (c, next) => {
      const auth = c.req.header("Authorization");
      if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== SYNC_API_KEY) {
        return c.json(
          { error: { message: "Invalid or missing API key", type: "authentication_error" } },
          401,
        );
      }
      await next();
    });
    logger.info("OpenAI compat endpoint protected by SYNC_API_KEY");
  } else {
    logger.warn("SYNC_API_KEY 未配置 — /v1/* 接口当前无鉴权，请勿在生产环境暴露");
  }
  app.route("/v1", openaiCompatRoute(sessionStore));

  // 对外开放接口（给其他系统调用）：GET /open/orders/progress
  // 用独立的 OPEN_API_KEY 做 Bearer 鉴权（与 MaxKB 的 SYNC_API_KEY 隔离，不同信任域）。
  // ⚠️ fail-closed：与 /v1 不同，未配置 key 时 /open/* 一律 503——
  // 对外接口未鉴权暴露 = 订单生产数据外泄，配置遗漏必须立即显性暴露而非静默放行。
  const OPEN_API_KEY = process.env.OPEN_API_KEY;
  if (OPEN_API_KEY) {
    app.use("/open/*", async (c, next) => {
      const auth = c.req.header("Authorization");
      if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== OPEN_API_KEY) {
        logOpenApiEvent({ event: "auth_fail", ip: c.req.header("x-forwarded-for") ?? "" });
        return c.json(
          { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" } },
          401,
        );
      }
      await next();
    });
    logger.info("Open API endpoint protected by OPEN_API_KEY");
  } else {
    app.use("/open/*", async (c) =>
      c.json(
        {
          ok: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "OPEN_API_KEY 未配置，/open/* 对外接口已禁用" },
        },
        503,
      ),
    );
    logger.error("OPEN_API_KEY 未配置 — /open/* 对外接口已禁用（fail-closed）");
  }
  app.route("/open", openApiRoute());

  app.get("/health", (c) => c.json({ status: "ok", service: "production-agent" }));

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });

  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 Chat API:    POST http://localhost:${PORT}/api/chat/:sessionId`);
  console.log(`🔌 OpenAI 兼容: POST http://localhost:${PORT}/v1/chat/completions  (MaxKB 接入用)`);
  console.log(`🌐 Open API:    GET  http://localhost:${PORT}/open/orders/progress  (外部系统，需 OPEN_API_KEY)`);
  console.log(`📁 Sessions:    GET  http://localhost:${PORT}/api/sessions`);
  console.log(`❤️  Health:      GET  http://localhost:${PORT}/health`);
  logger.info("Server started", { port: PORT });
}

main().catch((error) => {
  logger.error("Failed to start server", { error: String(error) });
  console.error("Failed to start server:", error);
  process.exit(1);
});
