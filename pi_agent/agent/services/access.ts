/**
 * Access — 唯一的授权判定
 *
 * 以前「这个人能看什么」散在四处：
 *   scopes.ts（机器人范围）、permissionGuard（角色矩阵）、
 *   tools.ts（业务范围钳制 ×2）、路由（构造 UserContext）。
 * 结果是策略的执行点落在工具体里：绕过工具（如 /open/*）就绕过 policy。
 *
 * 现在所有判定都从这里出：
 *   checkPermission(tool, args, user?)  —— 能不能用这个工具
 *   allowedTypes(user?)                 —— 这个身份能看到哪些业务范围
 *   narrowTypes(types, user?)           —— 把请求范围收窄到允许范围
 *
 * 返回值仍是 PermissionResult（向后兼容），新增的是「收窄后的范围」。
 */

import { ALL_BASE_NAMES, type BaseName } from "./businessScopes.js";
import { requireCurrentUser, type UserContext, type UserRole } from "./userContext.js";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

/** 任何角色都不可执行的前缀（只读系统的硬边界） */
const DENY_ALWAYS = [
  "update_", "delete_", "write_", "modify_",
  "execute_sql", "run_command",
];

/** 七个领域工具的共同可读角色。新增工具必须在这里登记。 */
const READ_ROLES: UserRole[] = ["sales", "engineer", "planner", "supervisor"];

const TOOL_ROLES: Record<string, UserRole[]> = {
  query_order_progress: READ_ROLES,
  query_orders_list: READ_ROLES,
  search_orders: READ_ROLES,
  get_production_stages: READ_ROLES,
  analyze_capacity: READ_ROLES,
  recommend_base: READ_ROLES,
  estimate_delivery: READ_ROLES,
};

/**
 * 计划岗的基地限制。target 是用户请求里的基地字段：
 * query_order_progress / query_orders_list 用 base，
 * analyze_capacity / estimate_delivery 用 base_name。
 *
 * 注意：baseId 的编码口径尚未统一（已知问题），这里保持原有文本比较，不做隐式映射。
 */
const PLANNER_DENIAL: Record<string, (target: string, home: string) => string> = {
  query_order_progress: (t, h) => `无权查询 ${t} 数据，您归属 ${h}`,
  query_orders_list: (t, h) => `无权查询 ${t} 数据，您归属 ${h}`,
  analyze_capacity: (t, h) => `无权查询 ${t} 负荷，您归属 ${h}`,
  estimate_delivery: (t, h) => `无权估算 ${t} 交期，您归属 ${h}`,
};

/**
 * 检查当前身份能否执行指定工具。
 *
 * @param toolName 工具名
 * @param args     工具参数（用于参数级约束）
 * @param user     身份；缺省从 ALS 读取（未认证会抛错）
 */
export function checkPermission(
  toolName: string,
  args: Record<string, unknown> = {},
  user: UserContext = requireCurrentUser(),
): PermissionResult {
  for (const prefix of DENY_ALWAYS) {
    if (toolName.startsWith(prefix)) {
      return { allowed: false, reason: "生产数据为只读，禁止修改" };
    }
  }

  const roles = TOOL_ROLES[toolName];
  if (!roles) {
    // 未知工具：仅主管放行（与原有行为一致）
    return user.role === "supervisor"
      ? { allowed: true }
      : { allowed: false, reason: `无权使用工具 ${toolName}` };
  }

  if (!roles.includes(user.role)) {
    return { allowed: false, reason: `角色 ${user.role} 无权执行 ${toolName}` };
  }

  const deny = PLANNER_DENIAL[toolName];
  if (deny && user.role === "planner" && user.baseId) {
    const target = (args.base ?? args.base_name) as string | undefined;
    if (target && target !== user.baseId) {
      return { allowed: false, reason: deny(target, user.baseId) };
    }
  }

  return { allowed: true };
}

/** 该身份可见的业务范围；未设置限制 = 全部 */
export function allowedTypes(user: UserContext = requireCurrentUser()): BaseName[] {
  return user.allowedBusinessTypes ?? ALL_BASE_NAMES;
}

/** 把请求的业务范围收窄到该身份允许的范围（保序、去重由调用方保证） */
export function narrowTypes(
  types: BaseName[],
  user: UserContext = requireCurrentUser(),
): BaseName[] {
  const allowed = allowedTypes(user);
  return types.filter((t) => allowed.includes(t));
}

/**
 * 开放接口的调用方没有用户身份，按独立信任域处理：API Key 即全量只读权限。
 * 显式声明在这里，避免「谁都能查」变成一个隐含事实。
 */
export const OPEN_API_PRINCIPAL: UserContext = {
  userId: "open-api",
  role: "supervisor",
  baseId: null,
};
