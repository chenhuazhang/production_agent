/**
 * Sessions API 客户端
 *
 * GET /api/sessions              — 历史会话列表
 * GET /api/sessions/:sessionId   — 单会话消息详情
 */

const API_URL = process.env.AI_API_URL || process.env.PYTHON_API_URL || "http://localhost:8000";

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

/** 获取历史会话列表 */
export async function fetchSessionList(): Promise<SessionListItem[]> {
  const res = await fetch(`${API_URL}/api/sessions`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.sessions ?? []) as SessionListItem[];
}

/** 删除指定会话 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  return res.ok;
}

/** 获取指定会话的完整消息历史 */
export async function fetchSessionHistory(sessionId: string): Promise<SessionHistory | null> {
  const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return null;
  return res.json();
}
