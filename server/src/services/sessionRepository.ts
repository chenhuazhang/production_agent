/**
 * SessionRepository — 会话存储的唯一实现
 *
 * 会话的真身是 pi-coding-agent 写出的 JSONL 文件；置顶信息另存 data/session-meta.json。
 * 以前这些细节散在 320 行的路由里：list / detail / rename / delete / pin
 * 各自 listAll() + find()，各自同步读写文件。
 *
 * 路由现在只做 HTTP：参数 → repository → JSON。
 * 文件格式只在这里出现一次，测试可以用临时目录替换 DATA_DIR。
 */

import { SessionManager, parseSessionEntries, type SessionInfo, type FileEntry } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile, unlink, access } from "node:fs/promises";
import { join } from "node:path";

// ============================================
// Types（对外 API 的形状）
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

export type PinnedMap = Record<string, boolean>;

export type RenameResult = "ok" | "not_found" | "invalid_name";

// ============================================
// Helpers
// ============================================

/** 检测并清理乱码文本（全是 U+FFFD 或不可读字符） */
function cleanGarbledText(text: string): string {
  if (!text) return "";
  const garbledCount = (text.match(/\uFFFD/g) || []).length;
  if (garbledCount > text.length / 2) return "";
  return text;
}

function toListItem(s: SessionInfo): SessionListItem {
  const cleanFirst = cleanGarbledText(s.firstMessage);
  const cleanName = cleanGarbledText(s.name ?? "");
  return {
    id: s.id,
    name: cleanName || cleanFirst.slice(0, 40) || "(新对话)",
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
    if (!("parentId" in e)) continue;
    if (e.type !== "message" || !("message" in e)) continue;

    const msg = (e as { message: { role: string; content: unknown } }).message;
    const role = msg.role as "user" | "assistant" | "system";
    if (role !== "user" && role !== "assistant") continue;

    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = (msg.content as Array<{ text?: string }>)
        .filter((b) => b.text)
        .map((b) => b.text)
        .join("\n");
    }

    if (text.trim()) {
      const cleaned = cleanGarbledText(text);
      msgs.push({
        id: e.id,
        role,
        content: cleaned || (role === "user" ? "(输入内容无法显示)" : text),
        timestamp: e.timestamp ?? new Date().toISOString(),
      });
    }
  }
  return msgs;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Repository
// ============================================

export class SessionRepository {
  private readonly dataDir: string;
  private readonly metaPath: string;

  constructor(dataDir: string = join(process.cwd(), "data")) {
    this.dataDir = dataDir;
    this.metaPath = join(dataDir, "session-meta.json");
  }

  /** 历史会话列表，置顶优先 */
  async list(): Promise<Array<SessionListItem & { pinned: boolean }>> {
    const items = (await SessionManager.listAll()).map(toListItem);
    const pinned = await this.readPinned();
    return items
      .map((item) => ({ ...item, pinned: !!pinned[item.id] }))
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });
  }

  /** 置顶映射 */
  async readPinned(): Promise<PinnedMap> {
    if (!(await exists(this.metaPath))) return {};
    try {
      const meta = JSON.parse(await readFile(this.metaPath, "utf-8")) as { pinned?: PinnedMap };
      return meta.pinned ?? {};
    } catch {
      return {};
    }
  }

  /** 单会话消息；不存在返回 null */
  async get(sessionId: string): Promise<SessionHistory | null> {
    const info = await this.find(sessionId);
    if (!info) return null;

    const raw = await readFile(info.path, "utf-8");
    const messages = extractMessages(parseSessionEntries(raw));
    return {
      id: info.id,
      name: info.name || info.firstMessage.slice(0, 40) || "(新对话)",
      created: info.created instanceof Date ? info.created.toISOString() : String(info.created),
      messages,
    };
  }

  /** 重命名：追加一条 session_info 条目，不动历史消息 */
  async rename(sessionId: string, name: string): Promise<RenameResult> {
    const info = await this.find(sessionId);
    if (!info) return "not_found";

    const newName = name.trim();
    if (!newName) return "invalid_name";

    const raw = await readFile(info.path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    lines.push(
      JSON.stringify({
        type: "session_info",
        name: newName,
        timestamp: new Date().toISOString(),
      }),
    );
    await writeFile(info.path, lines.join("\n") + "\n", "utf-8");
    return "ok";
  }

  /** 删除会话文件并清理置顶记录 */
  async remove(sessionId: string): Promise<boolean> {
    const info = await this.find(sessionId);
    if (!info) return false;

    await unlink(info.path);

    const meta = await this.readMeta();
    if (meta.pinned[sessionId]) {
      delete meta.pinned[sessionId];
      await this.writeMeta(meta);
    }
    return true;
  }

  /** 置顶 / 取消置顶 */
  async setPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    const info = await this.find(sessionId);
    if (!info) return false;

    const meta = await this.readMeta();
    if (pinned) meta.pinned[sessionId] = true;
    else delete meta.pinned[sessionId];
    await this.writeMeta(meta);
    return true;
  }

  // ── 内部 ──

  private async find(sessionId: string): Promise<SessionInfo | undefined> {
    const list = await SessionManager.listAll();
    return list.find((s) => s.id === sessionId);
  }

  private async readMeta(): Promise<{ pinned: PinnedMap }> {
    if (!(await exists(this.metaPath))) return { pinned: {} };
    try {
      const meta = JSON.parse(await readFile(this.metaPath, "utf-8")) as {
        pinned?: PinnedMap;
      };
      return { pinned: meta.pinned ?? {} };
    } catch {
      return { pinned: {} };
    }
  }

  private async writeMeta(meta: { pinned: PinnedMap }): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }
}
