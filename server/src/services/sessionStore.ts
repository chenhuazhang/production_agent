/**
 * SessionStore — 内存管理 AgentSession 实例。
 * - 30 分钟过期清理
 * - busy 状态防并发
 * Session 本身通过 SessionManager.create(cwd) 持久化到 JSONL，重启可恢复。
 */

import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

type AnyModel = Model<any>;

export interface SessionEntry {
  sessionId: string;
  session: AgentSession;
  /** 模型降级链（同端点同 Key，额度用尽时按序切换） */
  modelChain: AnyModel[];
  dispose: () => void;
  createdAt: Date;
  lastActiveAt: Date;
  isBusy: boolean;
}

export interface SessionCreateOptions {
  /** 注入系统提示的业务范围说明（MaxKB 多智能体按模型名分流用） */
  scopeNote?: string;
}

export type CreateSessionFn = (
  sessionFile?: string,
  opts?: SessionCreateOptions,
) => Promise<{
  session: AgentSession;
  modelChain: AnyModel[];
  dispose: () => void;
}>;

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private createSession: CreateSessionFn;

  constructor(createSession: CreateSessionFn) {
    this.createSession = createSession;
  }

  async getOrCreate(sessionId: string, opts?: SessionCreateOptions): Promise<SessionEntry> {
    let entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastActiveAt = new Date();
      return entry;
    }
    // 历史会话续聊：sessionId 是持久化的 UUID 时，找到对应会话文件恢复上下文。
    // sess- / maxkb- 前缀是临时会话 id（前端未绑定 / MaxKB 无状态），直接新建。
    let sessionFile: string | undefined;
    if (!sessionId.startsWith("sess-") && !sessionId.startsWith("maxkb-")) {
      try {
        const list = await SessionManager.listAll();
        const found = list.find((s) => s.id === sessionId);
        if (found?.path) sessionFile = found.path;
      } catch {
        // 查找失败则新建会话
      }
    }
    const { session, modelChain, dispose } = await this.createSession(sessionFile, opts);
    entry = {
      sessionId,
      session,
      modelChain,
      dispose,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      isBusy: false,
    };
    this.sessions.set(sessionId, entry);
    return entry;
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  delete(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.dispose();
      this.sessions.delete(sessionId);
    }
  }

  isBusy(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isBusy ?? false;
  }

  setBusy(sessionId: string, busy: boolean): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.isBusy = busy;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastActiveAt.getTime() > SESSION_TIMEOUT_MS) {
        this.delete(id);
      }
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
