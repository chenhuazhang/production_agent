"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { fetchSessionList, fetchSessionHistory, deleteSession as deleteSessionApi, renameSession as renameSessionApi, pinSession as pinSessionApi, type SessionListItem, type HistoryMessage } from "./sessions";

// ============================================
// Context
// ============================================

interface SessionCtx {
  /** 当前活跃会话 ID（空字符串 = 尚未初始化） */
  sessionId: string;
  /** 对话历史列表 */
  sessionList: SessionListItem[];
  /** 是否正在加载列表 */
  loading: boolean;
  /** 客户端水合是否完成（false 时不渲染交互元素，避免 hydration 不匹配导致事件丢失） */
  mounted: boolean;
  /** 切换到已有会话 */
  switchSession: (id: string) => Promise<HistoryMessage[] | null>;
  /** 新建会话 */
  newSession: () => void;
  /** 删除会话 */
  deleteSession: (id: string) => void;
  /** 重命名会话 */
  renameSession: (id: string, newName: string) => Promise<boolean>;
  /** 置顶/取消置顶会话 */
  pinSession: (id: string, pinned?: boolean) => Promise<boolean>;
  /** 刷新历史列表 */
  refresh: () => void;
}

const SessionContext = createContext<SessionCtx | null>(null);

const STORAGE_KEY = "production-agent-session-id";

// ============================================
// Provider
// ============================================

export function SessionProvider({ children }: { children: ReactNode }) {
  // mounted: 解决 SSR hydration 不一致（服务端和客户端 Date.now() 不同会导致事件丢失）
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 初始化：仅客户端执行，恢复上次 sessionId 或新建
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setSessionId(stored || `sess-${Date.now()}`);
    refreshList();
    setMounted(true);
  }, []);

  const persistId = useCallback((id: string) => {
    setSessionId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const refreshList = useCallback(() => {
    setLoading(true);
    fetchSessionList()
      .then((list) => setSessionList(list))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const switchSession = useCallback(async (id: string): Promise<HistoryMessage[] | null> => {
    const hist = await fetchSessionHistory(id);
    if (hist) {
      persistId(id);
      refreshList();
      return hist.messages;
    }
    return null;
  }, [persistId, refreshList]);

  const newSession = useCallback(() => {
    persistId(`sess-${Date.now()}`);
    refreshList();
  }, [persistId, refreshList]);

  const deleteSession = useCallback((id: string) => {
    deleteSessionApi(id).then((ok) => {
      if (ok) {
        // 如果删除的是当前会话，新建一个
        if (id === sessionId || sessionList.find((s) => s.id === id && s.id === sessionId)) {
          persistId(`sess-${Date.now()}`);
        }
        refreshList();
      }
    }).catch(() => {});
  }, [sessionId, sessionList, persistId, refreshList]);

  const renameSession = useCallback(async (id: string, newName: string): Promise<boolean> => {
    const ok = await renameSessionApi(id, newName);
    if (ok) refreshList();
    return ok;
  }, [refreshList]);

  const pinSession = useCallback(async (id: string, pinned: boolean = true): Promise<boolean> => {
    const ok = await pinSessionApi(id, pinned);
    if (ok) refreshList();
    return ok;
  }, [refreshList]);

  const refresh = refreshList;

  return (
    <SessionContext.Provider
      value={{ sessionId, sessionList, loading, mounted, switchSession, newSession, deleteSession, renameSession, pinSession, refresh }}
    >
      {children}
    </SessionContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
