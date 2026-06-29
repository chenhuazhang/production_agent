/**
 * Logger — 简单控制台日志，带时间戳与模块标签。
 */

type Level = "debug" | "info" | "warn" | "error";

function ts(): string {
  return new Date().toISOString();
}

export function createLogger(scope: string) {
  const tag = `[${scope}]`;
  return {
    debug: (msg: string, meta?: Record<string, unknown>) =>
      console.debug(`${ts()} ${tag} ${msg}`, meta ?? ""),
    info: (msg: string, meta?: Record<string, unknown>) =>
      console.log(`${ts()} ${tag} ${msg}`, meta ?? ""),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      console.warn(`${ts()} ${tag} ${msg}`, meta ?? ""),
    error: (msg: string, meta?: Record<string, unknown>) =>
      console.error(`${ts()} ${tag} ${msg}`, meta ?? ""),
    request: (sessionId: string, text: string) =>
      console.log(`${ts()} ${tag} → ${sessionId}: ${text.slice(0, 120)}`),
    response: (sessionId: string, ms: number) =>
      console.log(`${ts()} ${tag} ← ${sessionId} (${ms}ms)`),
    sseEvent: (sessionId: string, event: string) =>
      console.debug(`${ts()} ${tag} sse ${sessionId} ${event}`),
  } as const;
}

/** 清理 N 天前的日志（占位，当前未写文件） */
export function cleanOldLogs(_days: number): void {
  // no-op：控制台日志不落盘
}
