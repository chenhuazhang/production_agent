/**
 * Server Entry Point
 *
 * Hono 服务器：
 * - 加载 pi_agent/.env
 * - Chat API 路由（SSE）
 * - Session 管理（30 分钟过期清理）
 * - port 8000（兼容 web 端 PYTHON_API_URL 默认值）
 */

import { config } from "dotenv";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { chatRoute } from "./routes/chat";
import { sessionsRoute } from "./routes/sessions";
import { SessionStore } from "./services/sessionStore";
import { createLogger } from "./services/logger";
import { createSession } from "pi-agent";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// 相对于本脚本位置解析到 pi_agent/.env（不受 cwd 影响）
// server/src/index.ts → server/ (.. .. ) → production_agent/ (.. ) → pi_agent/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", "pi_agent", ".env");
config({ path: ENV_PATH });

const logger = createLogger("main");

const PORT = Number(process.env.PORT) || 8000;

async function createAgentSession() {
  const { session, dispose } = await createSession();
  return { session, dispose };
}

async function main() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  const sessionStore = new SessionStore(createAgentSession);

  setInterval(() => {
    sessionStore.cleanup();
    logger.debug("Session cleanup", { activeSessions: sessionStore.size });
  }, 5 * 60 * 1000);

  app.route("/api/chat", chatRoute(sessionStore));
  app.route("/api/sessions", sessionsRoute());

  app.get("/health", (c) => c.json({ status: "ok", service: "production-agent" }));

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });

  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 Chat API:    POST http://localhost:${PORT}/api/chat/:sessionId`);
  console.log(`📁 Sessions:    GET  http://localhost:${PORT}/api/sessions`);
  console.log(`❤️  Health:      GET  http://localhost:${PORT}/health`);
  logger.info("Server started", { port: PORT });
}

main().catch((error) => {
  logger.error("Failed to start server", { error: String(error) });
  console.error("Failed to start server:", error);
  process.exit(1);
});
