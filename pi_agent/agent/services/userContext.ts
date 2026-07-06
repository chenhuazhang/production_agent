/**
 * UserContext - AsyncLocalStorage 传递用户身份
 *
 * 每个 HTTP 请求到达时在 chat route 中设置，
 * 工具执行时从 ALS 读取，用于权限检查。
 *
 * 用法：
 *   // chat route
 *   await runWithUser({ role: "planner", userId: "u1", baseId: "gz" }, () => session.prompt(text));
 *
 *   // tool
 *   const user = getCurrentUser();
 *   if (!user) throw new Error("未认证");
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ============================================
// 类型
// ============================================

export type UserRole = "sales" | "engineer" | "planner" | "supervisor";

export interface UserContext {
  /** CRM 用户 ID */
  userId: string;
  /** 角色：sales(业务员) | engineer(技术工程师) | planner(计划岗) | supervisor(主管+) */
  role: UserRole;
  /** 所属基地 ID（计划岗有归属基地限制；主管为 null 表示全部基地） */
  baseId: string | null;
}

// ============================================
// AsyncLocalStorage 实例
// ============================================

const storage = new AsyncLocalStorage<UserContext>();

/**
 * 在当前异步上下文中设置用户，执行回调。
 * 回调结束后自动清理。
 */
export function runWithUser<T>(user: UserContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(user, fn);
}

/**
 * 获取当前请求的用户身份。
 * 工具执行时调用；如果未在 runWithUser 上下文中，返回 null（未认证）。
 */
export function getCurrentUser(): UserContext | null {
  return storage.getStore() ?? null;
}

/**
 * 断言已认证，否则抛出错误。
 */
export function requireCurrentUser(): UserContext {
  const user = getCurrentUser();
  if (!user) {
    throw new Error("未通过用户认证，无法执行操作。请从 CRM 系统登录后重试。");
  }
  return user;
}
