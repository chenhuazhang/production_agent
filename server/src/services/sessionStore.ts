/**
 * SessionStore — 内存管理 AgentSession 实例。
 * - 30 分钟过期清理
 * - busy 状态防并发
 * Session 本身通过 SessionManager.create(cwd) 持久化到 JSONL，重启可恢复。
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface SessionEntry {
  sessionId: string;
  session: AgentSession;
  dispose: () => void;
  createdAt: Date;
  lastActiveAt: Date;
  isBusy: boolean;
}

export type CreateSessionFn = () => Promise<{
  session: AgentSession;
  dispose: () => void;
}>;

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private createSession: CreateSessionFn;

  constructor(createSession: CreateSessionFn) {
    this.createSession = createSession;
  }

  async getOrCreate(sessionId: string): Promise<SessionEntry> {
    let entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastActiveAt = new Date();
      return entry;
    }
    const { session, dispose } = await this.createSession();
    entry = {
      sessionId,
      session,
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
