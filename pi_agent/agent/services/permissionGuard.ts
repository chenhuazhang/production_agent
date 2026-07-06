/**
 * PermissionGuard - 工具调用权限检查
 *
 * 从 §7.6 权限管理设计的岗位权限矩阵直接编码。
 * 遵循最小权限原则：任何人都不可修改生产数据。
 *
 * 用法（每个工具 execute 开头）：
 *   const result = checkPermission("query_order_progress", { base_name: "中试广州" });
 *   if (!result.allowed) return textResult({ error: result.reason });
 */

import type { UserContext, UserRole } from "./userContext.js";
import { requireCurrentUser } from "./userContext.js";

// ============================================
// 权限检查结果
// ============================================

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

// ============================================
// 禁止前缀（任何人不可执行）
// ============================================

const DENY_ALWAYS = [
  "update_", "delete_", "write_", "modify_",
  "execute_sql", "run_command",
];

// ============================================
// 权限矩阵
// ============================================

/**
 * 每个工具的访问规则。
 * key: 工具名
 * value: 允许执行的 UserRole 集合 + 额外参数级约束
 */
type ToolPermission = {
  allowRoles: UserRole[];
  /** 额外参数级约束（可选）：检查 args 中是否存在跨权限的数据 */
  paramCheck?: (user: UserContext, args: Record<string, unknown>) => PermissionResult;
};

const TOOL_PERMISSIONS: Record<string, ToolPermission> = {
  // ── 订单进度查询 ──
  query_order_progress: {
    allowRoles: ["sales", "engineer", "planner", "supervisor"],
    paramCheck: (user, args) => {
      // 计划岗只能查本基地
      if (user.role === "planner" && user.baseId) {
        const targetBase = args.base as string | undefined;
        if (targetBase && targetBase !== user.baseId) {
          return { allowed: false, reason: `无权查询 ${targetBase} 数据，您归属 ${user.baseId}` };
        }
      }
      return { allowed: true };
    },
  },

  search_orders: {
    allowRoles: ["sales", "engineer", "planner", "supervisor"],
    paramCheck: (user, _args) => {
      // 业务员只能搜自己的订单（简化：此处由前端限制，后端传 user_id 过滤）
      // supervisor / planner 可搜全量
      return { allowed: true };
    },
  },

  get_production_stages: {
    allowRoles: ["sales", "engineer", "planner", "supervisor"],
  },

  // ── 产能负荷分析 ──
  analyze_capacity: {
    allowRoles: ["sales", "engineer", "planner", "supervisor"],
    paramCheck: (user, args) => {
      // 计划岗只能看本基地负荷
      if (user.role === "planner" && user.baseId) {
        const targetBase = args.base_name as string | undefined;
        if (targetBase && targetBase !== user.baseId) {
          return { allowed: false, reason: `无权查询 ${targetBase} 负荷，您归属 ${user.baseId}` };
        }
      }
      return { allowed: true };
    },
  },

  recommend_base: {
    allowRoles: ["sales", "engineer", "planner", "supervisor"],
  },

  estimate_delivery: {
    allowRoles: ["sales", "engineer", "planner", "supervisor"],
    paramCheck: (user, args) => {
      if (user.role === "planner" && user.baseId) {
        const targetBase = args.base_name as string | undefined;
        if (targetBase && targetBase !== user.baseId) {
          return { allowed: false, reason: `无权估算 ${targetBase} 交期，您归属 ${user.baseId}` };
        }
      }
      return { allowed: true };
    },
  },
};

// ============================================
// 检查函数
// ============================================

/**
 * 检查当前用户是否有权限执行指定工具。
 *
 * @param toolName  工具名
 * @param args      工具参数（用于参数级约束检查）
 * @returns         权限检查结果
 */
export function checkPermission(
  toolName: string,
  args: Record<string, unknown> = {},
): PermissionResult {
  // Step 0: 未认证拦截
  const user = requireCurrentUser();

  // Step 1: 硬拦截——任何人不可执行写操作
  for (const prefix of DENY_ALWAYS) {
    if (toolName.startsWith(prefix)) {
      return { allowed: false, reason: "生产数据为只读，禁止修改" };
    }
  }

  // Step 2: 工具白名单检查
  const perm = TOOL_PERMISSIONS[toolName];
  if (!perm) {
    // 未知工具：仅主管放行
    return user.role === "supervisor"
      ? { allowed: true }
      : { allowed: false, reason: `无权使用工具 ${toolName}` };
  }

  // Step 3: 角色检查
  if (!perm.allowRoles.includes(user.role)) {
    return { allowed: false, reason: `角色 ${user.role} 无权执行 ${toolName}` };
  }

  // Step 4: 参数级约束检查
  if (perm.paramCheck) {
    return perm.paramCheck(user, args);
  }

  return { allowed: true };
}
