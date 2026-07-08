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
import { join } from "node:path";

const logger = createLogger("sessions");

// 元数据存放目录（与 pi_agent data 目录对齐）
const DATA_DIR = join(process.cwd(), "data");

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

/** 检测并清理乱码文本（全是 � 或不可读字符） */
function cleanGarbledText(text: string): string {
  if (!text) return "";
  // 如果超过半数字符是 � (U+FFFD)，视为乱码
  const garbledCount = (text.match(/�/g) || []).length;
  if (garbledCount > text.length / 2) return "";
  return text;
}

function toListItem(s: SessionInfo): SessionListItem {
  const cleanFirst = cleanGarbledText(s.firstMessage);
  const cleanName = cleanGarbledText(s.name);
  const name = cleanName || cleanFirst.slice(0, 40) || "(新对话)";
  return {
    id: s.id,
    name,
    created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
    modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
    messageCount: s.messageCount,
    firstMessage: cleanFirst.slice(0, 100),
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
        // 如果用户消息全是乱码，尝试用上下文推断（或用空白替代）
        const cleaned = cleanGarbledText(text);
        msgs.push({
          id: e.id,
          role,
          content: cleaned || (role === "user" ? "(输入内容无法显示)" : text),
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

      // 读取置顶信息
      const metaPath = join(DATA_DIR, "session-meta.json");
      const pinned: Record<string, boolean> = {};
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          Object.assign(pinned, meta.pinned ?? {});
        } catch { /* 忽略读取错误 */ }
      }

      // 给每个 item 加上 pinned 字段
      const itemsWithPin = items.map((item) => ({
        ...item,
        pinned: !!pinned[item.id],
      }));

      // 置顶的排前面
      itemsWithPin.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });

      logger.info("Sessions listed (all dirs)", { count: itemsWithPin.length });
      return c.json({ sessions: itemsWithPin });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to list sessions", { error: msg });
      return c.json({ error: msg, sessions: [] }, 500);
    }
  });

  // ── 置顶列表（必须在 :sessionId 之前，避免被当作参数匹配） ──

  app.get("/pinned", async (_c) => {
    const metaPath = join(DATA_DIR, "session-meta.json");
    if (!fs.existsSync(metaPath)) {
      return _c.json({ pinned: {} });
    }
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      return _c.json({ pinned: meta.pinned ?? {} });
    } catch {
      return _c.json({ pinned: {} });
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

  // ── 重命名 ──────────────────────────────────

  app.patch("/:sessionId/rename", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const list = await SessionManager.listAll();
      const info = list.find((s) => s.id === sessionId);
      if (!info) {
        return c.json({ error: "会话不存在" }, 404);
      }

      const body = await c.req.json();
      const newName = (body.name as string ?? "").trim();
      if (!newName) {
        return c.json({ error: "名称不能为空" }, 400);
      }

      // 读取 JSONL 文件，追加一条 session_info 条目来更新名称
      const raw = fs.readFileSync(info.path, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const sessionInfoEntry = {
        type: "session_info",
        name: newName,
        timestamp: new Date().toISOString(),
      };
      lines.push(JSON.stringify(sessionInfoEntry));
      fs.writeFileSync(info.path, lines.join("\n") + "\n", "utf-8");

      logger.info("Session renamed", { sessionId, newName });
      return c.json({ ok: true, name: newName });
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
      const list = await SessionManager.listAll();
      const info = list.find((s) => s.id === sessionId);
      if (!info) {
        return c.json({ error: "会话不存在" }, 404);
      }

      fs.unlinkSync(info.path);

      // 同步清理元数据中的置顶记录
      const metaPath = join(DATA_DIR, "session-meta.json");
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          if (meta.pinned && meta.pinned[sessionId]) {
            delete meta.pinned[sessionId];
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
          }
        } catch { /* 元数据读取失败不影响删除 */ }
      }

      logger.info("Session deleted", { sessionId, path: info.path });
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
      const list = await SessionManager.listAll();
      const info = list.find((s) => s.id === sessionId);
      if (!info) {
        return c.json({ error: "会话不存在" }, 404);
      }

      const body = await c.req.json();
      const pinned = body.pinned !== false; // 默认 true

      // 读取或创建元数据文件
      const metaPath = join(DATA_DIR, "session-meta.json");
      let meta: { pinned: Record<string, boolean> } = { pinned: {} };
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          if (!meta.pinned) meta.pinned = {};
        } catch { /* 文件损坏则重置 */ }
      }

      if (pinned) {
        meta.pinned[sessionId] = true;
      } else {
        delete meta.pinned[sessionId];
      }

      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

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
