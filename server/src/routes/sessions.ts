/**
 * Sessions API Route
 *
 * GET  /api/sessions                 — 对话历史列表（含预览）
 * GET  /api/sessions/:sessionId       — 单会话完整消息
 */

import { Hono } from "hono";
import {
  SessionManager,
  parseSessionEntries,
  type SessionInfo,
  type FileEntry,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import { createLogger } from "../services/logger";

const logger = createLogger("sessions");

// ============================================
// Types for API response
// ============================================

export interface SessionListItem {
  id: string;
  name: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface SessionHistory {
  id: string;
  name: string;
  created: string;
  messages: HistoryMessage[];
}

// ============================================
// Helpers
// ============================================

function toListItem(s: SessionInfo): SessionListItem {
  return {
    id: s.id,
    name: s.name || s.firstMessage.slice(0, 40) || "(新对话)",
    created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
    modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
    messageCount: s.messageCount,
    firstMessage: s.firstMessage.slice(0, 100),
  };
}

/** 从 FileEntry[] 中提取 user / assistant 消息（跳过 session header 等非消息条目） */
function extractMessages(entries: FileEntry[]): HistoryMessage[] {
  const msgs: HistoryMessage[] = [];
  for (const e of entries) {
    if (!("parentId" in e)) continue; // session header
    if (e.type === "message" && "message" in e) {
      const msg = (e as { message: { role: string; content: unknown } }).message;
      const role = msg.role as "user" | "assistant" | "system";
      if (role !== "user" && role !== "assistant") continue;

      // content 可能是 string 或 ContentBlock[]
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = (msg.content as Array<{ text?: string }>)
          .filter((b: { text?: string }) => b.text)
          .map((b: { text?: string }) => b.text)
          .join("\n");
      }

      if (text.trim()) {
        msgs.push({
          id: e.id,
          role,
          content: text,
          timestamp: e.timestamp ?? new Date().toISOString(),
        });
      }
    }
  }
  return msgs;
}

// ============================================
// Route
// ============================================

export function sessionsRoute() {
  const app = new Hono();

  // ── 列表 ────────────────────────────────────

  app.get("/", async (c) => {
    try {
      const list = await SessionManager.listAll();
      const items = list.map(toListItem);

      logger.info("Sessions listed (all dirs)", { count: items.length });
      return c.json({ sessions: items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to list sessions", { error: msg });
      return c.json({ error: msg, sessions: [] }, 500);
    }
  });

  // ── 详情 ────────────────────────────────────

  app.get("/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      // 从所有项目目录中查找
      const list = await SessionManager.listAll();
      const info = list.find((s) => s.id === sessionId);
      if (!info) {
        return c.json({ error: "会话不存在" }, 404);
      }

      // 读取 JSONL 文件并解析
      const raw = fs.readFileSync(info.path, "utf-8");
      const entries = parseSessionEntries(raw);
      const messages = extractMessages(entries);

      logger.info("Session history loaded", { sessionId, messages: messages.length });
      return c.json({
        id: info.id,
        name: info.name || info.firstMessage.slice(0, 40) || "(新对话)",
        created: info.created instanceof Date ? info.created.toISOString() : String(info.created),
        messages,
      } satisfies SessionHistory);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to load session", { sessionId, error: msg });
      return c.json({ error: msg, messages: [] }, 500);
    }
  });

  // ── 删除 ────────────────────────────────────

  app.delete("/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const list = await SessionManager.listAll();
      const info = list.find((s) => s.id === sessionId);
      if (!info) {
        return c.json({ error: "会话不存在" }, 404);
      }

      fs.unlinkSync(info.path);
      logger.info("Session deleted", { sessionId, path: info.path });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to delete session", { sessionId, error: msg });
      return c.json({ error: msg }, 500);
    }
  });

  return app;
}
