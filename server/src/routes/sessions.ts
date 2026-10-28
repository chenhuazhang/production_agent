/**
 * Sessions API Route
 *
 * GET    /api/sessions                  — 历史会话列表（含预览、置顶优先）
 * GET    /api/sessions/pinned           — 置顶映射
 * GET    /api/sessions/:sessionId       — 单会话完整消息
 * PATCH  /api/sessions/:sessionId/rename
 * PATCH  /api/sessions/:sessionId/pin
 * DELETE /api/sessions/:sessionId
 *
 * 路由只做 HTTP；JSONL 与 meta 文件的读写都在 SessionRepository。
 */

import { Hono } from "hono";
import { createLogger } from "../services/logger";
import { SessionRepository } from "../services/sessionRepository";

export type {
  SessionListItem,
  HistoryMessage,
  SessionHistory,
} from "../services/sessionRepository";

const logger = createLogger("sessions");

export function sessionsRoute(repo: SessionRepository = new SessionRepository()) {
  const app = new Hono();

  // ── 列表 ────────────────────────────────────

  app.get("/", async (c) => {
    try {
      const sessions = await repo.list();
      logger.info("Sessions listed (all dirs)", { count: sessions.length });
      return c.json({ sessions });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to list sessions", { error: msg });
      return c.json({ error: msg, sessions: [] }, 500);
    }
  });

  // ── 置顶列表（必须在 :sessionId 之前，避免被当作参数匹配） ──

  app.get("/pinned", async (c) => {
    try {
      return c.json({ pinned: await repo.readPinned() });
    } catch {
      return c.json({ pinned: {} });
    }
  });

  // ── 详情 ────────────────────────────────────

  app.get("/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const history = await repo.get(sessionId);
      if (!history) return c.json({ error: "会话不存在" }, 404);
      logger.info("Session history loaded", {
        sessionId,
        messages: history.messages.length,
      });
      return c.json(history);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to load session", { sessionId, error: msg });
      return c.json({ error: msg, messages: [] }, 500);
    }
  });

  // ── 重命名 ──────────────────────────────────

  app.patch("/:sessionId/rename", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const body = await c.req.json().catch(() => ({}) as { name?: unknown });
      const name = typeof body.name === "string" ? body.name : "";
      const result = await repo.rename(sessionId, name);

      if (result === "not_found") return c.json({ error: "会话不存在" }, 404);
      if (result === "invalid_name") return c.json({ error: "名称不能为空" }, 400);

      logger.info("Session renamed", { sessionId, newName: name.trim() });
      return c.json({ ok: true, name: name.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to rename session", { sessionId, error: msg });
      return c.json({ error: msg }, 500);
    }
  });

  // ── 删除 ────────────────────────────────────

  app.delete("/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const removed = await repo.remove(sessionId);
      if (!removed) return c.json({ error: "会话不存在" }, 404);
      logger.info("Session deleted", { sessionId });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to delete session", { sessionId, error: msg });
      return c.json({ error: msg }, 500);
    }
  });

  // ── 置顶/取消置顶 ────────────────────────────

  app.patch("/:sessionId/pin", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const body = await c.req.json().catch(() => ({}) as { pinned?: unknown });
      const pinned = body.pinned !== false;

      const ok = await repo.setPinned(sessionId, pinned);
      if (!ok) return c.json({ error: "会话不存在" }, 404);

      logger.info("Session pin updated", { sessionId, pinned });
      return c.json({ ok: true, pinned });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to pin session", { sessionId, error: msg });
      return c.json({ error: msg }, 500);
    }
  });

  return app;
}
