# 权限模型：中试 AI 助手

## 角色定义

| 角色 | 谁 | 数据范围 | 工具权限 |
|------|-----|-----------|---------|
| `sales` | 营销中心业务员 | 全基地（当前）；未来应限制为客户归属 | 全部 6 个工具 |
| `engineer` | 技术中心工程师 | 全基地 | 全部 6 个工具 |
| `planner` | 计划岗 | **仅本基地**（baseId 约束） | 全部 6 个工具，但跨基地查询被拒绝 |
| `supervisor` | 主管 / 管理层 | 全基地 | 全部 6 个工具 + 任何未知工具放行 |

## 资源 × 操作 × 角色矩阵

| 资源 | 操作 | sales | engineer | planner | supervisor | 匿名用户 |
|----------|-----------|-------|----------|---------|------------|-----------|
| 订单进度 | 查（本基地） | ✅ | ✅ | ✅ | ✅ | ✅ (⚠️) |
| 订单进度 | 查（其他基地） | ✅ | ✅ | ❌ | ✅ | ✅ (⚠️) |
| 搜索订单 | 查 | ✅ | ✅ | ✅ | ✅ | ✅ (⚠️) |
| 生产工序 | 查 | ✅ | ✅ | ✅ | ✅ | ✅ (⚠️) |
| 产能分析 | 查（本基地） | ✅ | ✅ | ✅ | ✅ | ✅ (⚠️) |
| 产能分析 | 查（其他基地） | ✅ | ✅ | ❌ | ✅ | ✅ (⚠️) |
| 推荐基地 | 查 | ✅ | ✅ | ✅ | ✅ | ✅ (⚠️) |
| 估算交期 | 计算（本基地） | ✅ | ✅ | ✅ | ✅ | ✅ (⚠️) |
| 估算交期 | 计算（其他基地） | ✅ | ✅ | ❌ | ✅ | ✅ (⚠️) |
| **任意写操作** | 增/改/删 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 会话列表 | 读 | ⚠️ 无鉴权 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 会话详情 | 读 | ⚠️ 无鉴权 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 会话删除 | 删 | ⚠️ 无鉴权 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

✅ = 代码已强制
❌ = 代码已禁止
⚠️ = 无强制（缺口）

## 权限执行路径

### 代码层执行（permissionGuard.ts）

```
checkPermission(toolName, args):
  第 0 步: requireCurrentUser() — 从 ALS 获取用户上下文，缺失则抛异常
  第 1 步: DENY_ALWAYS 前缀检查 — 拦截 update_/delete_/write_/modify_/execute_sql/run_command
  第 2 步: 工具白名单 — 查找 TOOL_PERMISSIONS
  第 3 步: 角色检查 — user.role 必须在 perm.allowRoles 中
  第 4 步: 参数检查 — planner 基地约束通过 perm.paramCheck()
```

### 基地级限制（planner 角色）

```typescript
// planner 只能查自己归属的基地
if (user.role === "planner" && user.baseId) {
  const targetBase = args.base_name; // 或 args.base
  if (targetBase && targetBase !== user.baseId) {
    return { allowed: false, reason: `无权查询 ${targetBase} 数据` };
  }
}
```

### 写操作：硬拦截

```typescript
const DENY_ALWAYS = [
  "update_", "delete_", "write_", "modify_",
  "execute_sql", "run_command",
];
// 工具名以这些前缀开头的 → 任何角色都拒绝
```

### Agent 工具面限制

LLM Agent 只能调用 6 个工具，通过 `TOOL_NAMES` 白名单限制：
- `query_order_progress`
- `search_orders`
- `get_production_stages`
- `analyze_capacity`
- `recommend_base`
- `estimate_delivery`

无文件系统访问、无 Shell 执行、无网络工具。

## 已知缺口 (⚠️)

| 缺口 | 严重程度 | 说明 | 修复计划 |
|-----|----------|-------------|----------------|
| API 层无鉴权 | **Critical** | 用户身份来自可伪造的请求体；ANON_USER 默认为 supervisor | 正式上线前替换为 JWT / CRM SSO |
| Session API 无鉴权 | **High** | 任意用户可列表/读取/删除任意会话 | 为 /api/sessions/* 添加鉴权中间件 |
| CORS 通配符 | **High** | `origin: "*"` 允许任意来源跨域请求 | 限制为已知前端域名 |
| 无频率限制 | **Medium** | Chat API 可被无限制调用 | 添加 per-session rate limiter |
| 基地限制仅检查显式参数 | **Medium** | planner 不传 base 时限制被绕过（并行查全部基地） | 添加查询后过滤，或拒绝 planner 的无 base 查询 |

## 鉴权状态

**当前（开发阶段）**: `ANON_USER = { userId: "anonymous", role: "supervisor", baseId: null }`

**目标（生产环境）**: CRM SSO JWT → 解析为 `UserContext { userId, role, baseId }`

`runWithUser(user, fn)` 的 ALS 模式已就位 — 切换只需将 `user` 的来源从 `body.user ?? ANON_USER` 改为 `verifyToken(header)`。
