# 测试覆盖：中试 AI 助手

**状态**: 无自动化测试套件（仅 4 个手动 E2E 脚本）
**生成日期**: 2026-07-06

---

## 覆盖矩阵

| # | 用例 | 规则（来源） | 预期行为（+ 拒绝场景） | 证据 | 类型 | 状态 |
|---|----------|-------------------|--------------------------------|----------|------|--------|
| **鉴权** |
| A1 | 未认证用户拒绝工具调用 | [permissions.md] 无鉴权 → 401 | `requireCurrentUser()` 抛异常 → 工具返回 error | permissionGuard.ts:127 | unit | 待写 |
| A2 | Sales 可查全基地订单 | [permissions.md] role=sales → 放行 | `checkPermission("query_order_progress")` → allowed | permissionGuard.ts:50-51 | unit | 待写 |
| A3 | Planner 跨基地查询被拒绝 | [permissions.md] role=planner, baseId≠target → 拒绝 | `checkPermission("query_order_progress", {base:"上海"})` 且 user.baseId="广州" → denied | permissionGuard.ts:53-58 | unit | 待写 |
| A4 | 任何人不可执行写操作 | [permissions.md] write 前缀 → 拒绝 | `checkPermission("update_order")` → denied | permissionGuard.ts:28-31 | unit | 待写 |
| A5 | 未知工具仅 supervisor 放行 | [permissions.md] unknown tool → supervisor only | `checkPermission("unknown_tool")` → sales 被拒，supervisor 放行 | permissionGuard.ts:138-141 | unit | 待写 |
| A6 | Session API 需鉴权 | [flows.md] GET /api/sessions → 401 | 未认证 → 401 | flows.md L6（缺口） | integration | 待写 |
| **数据完整性** |
| D1 | SQL 查询参数化防注入 | [automation.md] @orderNo 绑定 | order_no 含 SQL 注入尝试 → 不泄露数据 | sqlServer.ts:296 | unit | 待写 |
| D2 | SQL 失败回退 mock + 明确标注 | [flows.md] SQL error → mock + 标注 | SQL 连接被拒 → 返回 mock 数据并标注"模拟数据" | tools.ts:90-98 | unit | 待写 |
| D3 | 并行查询 4 个基地（未指定 base） | [flows.md] no base → Promise.all(4) | `queryOrderProgressMany("X001")` → 4 个并发查询 | sqlServer.ts:317 | integration | 待写 |
| D4 | 订单不存在时友好提示 | [flows.md] not found → hint | `queryOrderProgress("NONEXIST", base)` → `{found:false, error:"未找到"}` | tools.ts:67-69 | unit | 待写 |
| D5 | 产能公式正确 | [flows.md] 日产能 = 台数 × 单台产量 | `calculateDailyCapacity(12, 8)` → 96 | capacity.ts:40-46 | unit | 待写 |
| D6 | 推荐选择负荷率最低基地 | [flows.md] 按 loadRate 排序 → 选最低 | `recommendBase([{load:80},{load:30},{load:60}])` → load=30 的基地 | capacity.ts:85-105 | unit | 待写 |
| **Agent 行为面** |
| S1 | LLM 仅可调用白名单工具 | [automation.md] TOOL_NAMES 限制 | Agent 尝试非白名单工具 → 框架拦截 | session.ts:91 | integration | 待写 |
| S2 | 超出职责范围拒绝 | [automation.md] out-of-scope → 礼貌拒绝 | "今天天气怎么样" → LLM 回复拒绝（不调用工具） | AGENTS.md:48 | guarded-live | 待写 |
| S3 | 信息不足时主动追问 | [automation.md] 缺信息 → 追问 | "帮我查一下"（无订单号） → LLM 追问"请提供订单号" | AGENTS.md:62 | guarded-live | 待写 |
| **SSE 协议** |
| E1 | text_delta 事件正确流式传输 | [automation.md] SSE 事件类型 | POST /api/chat → SSE 流含 text_delta 事件 | chat.ts:39-40 | guarded-live | 已有 |
| E2 | tool_start/tool_end 事件序列 | [automation.md] 工具生命周期 | LLM 调用工具 → tool_start 先于 execute 发出，tool_end 在完成后发出 | chat.ts:46-51 | guarded-live | 已有 |
| E3 | done 事件在流结束时发送 | [automation.md] agent_end → done | Agent 本轮结束 → "done" 事件发出 | chat.ts:53-54 | guarded-live | 已有 |
| E4 | thinking_delta 事件转发 | [automation.md] 思考 token 可见 | 推理模型 → SSE 流含 thinking_delta 事件 | chat.ts:41-43 | guarded-live | 已有 |
| E5 | error 事件在异常时发送 | [automation.md] 异常处理 | LLM API 异常 → "error" 事件带消息（不崩溃） | chat.ts:57-58 | guarded-live | 已有 |
| **会话管理** |
| M1 | Session 30min 过期自动清理 | [architecture.md] TTL 清理 | 创建 session，时钟前进 31min → session 被删除 | sessionStore.ts:74-81 | unit | 待写 |
| M2 | Busy flag 阻止并发请求 | [architecture.md] busy → 429 | Session isBusy=true → POST 返回 429 | chat.ts:90-93 | integration | 待写 |
| M3 | Session 创建失败返回友好错误 | [flows.md] create fail → 500 + msg | 缺少 API Key → 500 JSON（不崩溃） | chat.ts:98-103 | integration | 待写 |
| **性能（来自审计）** |
| P1 | 看板查询并行化 | [perf audit 1.2] 并发查询 | `fetchAllDashboardOrders()` → 4 个查询同时发出 | web sqlServer.ts:296 | integration | 待写 |
| P2 | 同步 I/O 已替换为异步 | [perf audit 5.1] 无 fs.*Sync | `ExecutionTracer.persist()` 使用 fs.promises | executionTracer.ts:148 | unit | 待写 |

---

## 已有覆盖

4 个手动 E2E 脚本已验证的规则：

| 测试文件 | 已验证规则 | 类型 |
|-----------|---------------|------|
| `tests/e2e_chat.mjs` | SSE 流式响应 + tool_start/tool_end + done 事件 | guarded-live（手动） |
| `tests/e2e_sql.mjs` | SQL Server 真实查询 + tool result 内容截断展示 | guarded-live（手动） |
| `tests/e2e_chat_followup.mjs` | 多轮对话上下文保持 | guarded-live（手动） |
| `tests/e2e_thinking.mjs` | thinking_delta 事件转发 | guarded-live（手动） |

**零个单元测试。零个集成测试。零条 CI 流水线。**

---

## 待写测试

### 单元测试（确定性，无外部依赖）

#### PermissionGuard (`permissionGuard.test.ts`)

```
test: sales 可查询订单进度
  arrange: user={role:"sales", baseId:null}
  act: checkPermission("query_order_progress", {})
  assert: { allowed: true }

test: planner 跨基地查询被拒绝
  arrange: user={role:"planner", baseId:"广州"}
  act: checkPermission("query_order_progress", {base:"上海"})
  assert: { allowed: false, reason: 含 "无权查询" }

test: 写操作任何角色都被拒绝
  arrange: user={role:"supervisor"}
  act: checkPermission("update_order", {})
  assert: { allowed: false, reason: 含 "禁止修改" }

test: 未知工具非 supervisor 被拒绝
  arrange: user={role:"sales"}
  act: checkPermission("dangerous_tool", {})
  assert: { allowed: false }

test: 未知工具 supervisor 放行
  arrange: user={role:"supervisor"}
  act: checkPermission("dangerous_tool", {})
  assert: { allowed: true }

test: 缺少用户上下文抛异常
  arrange: 无 ALS 上下文
  act: checkPermission("any_tool", {})
  assert: throws "未通过用户认证"
```

#### 产能公式 (`capacity.test.ts`)

```
test: 日产能 = 台数 × 单台产量
  act: calculateDailyCapacity(12, 8)
  assert: 96

test: 无效输入时日产能为零
  act: calculateDailyCapacity(0, 100)
  assert: 0

test: 负荷率计算
  act: calculateLoadMetrics(50, 100)
  assert: { load_rate: 50, overload_multiplier: 0.5, days_to_complete: 0.5 }

test: 推荐负荷最低基地
  arrange: [{base:"A", load_rate:80}, {base:"B", load_rate:30}, {base:"C", load_rate:60}]
  act: recommendBase(data)
  assert: recommended_base = "B"

test: 估算交期需累加新订单到待处理
  act: estimateDelivery({ base_name:"GZ", pending_orders:30, daily_capacity:10, order_quantity:5 })
  assert: estimated_days = 3.5
```

#### SessionStore (`sessionStore.test.ts`)

```
test: 30 分钟后 session 过期
  act: 创建 session → 快进 31min → 执行 cleanup()
  assert: session 被删除, size = 0

test: busy 标记阻止并发
  act: setBusy(id, true)
  assert: isBusy(id) = true
```

#### 输入验证 (`tools.test.ts`)

```
test: SQL 参数绑定而非拼接
  arrange: spy on pool.request().input()
  act: queryOrderProgress("test'; DROP TABLE--", "中试广州")
  assert: input() 被调用参数为 ("orderNo", NVarChar, "test'; DROP TABLE--")
         — 恶意 SQL 被当作字面字符串处理
```

### 集成测试（本地依赖：test DB 或 mock server）

#### Chat API Route (`chat.test.ts`)

```
test: POST /api/chat/:sessionId 空文本返回 400
  act: POST { text: "" }
  assert: 400 { error: "Text is required" }

test: POST /api/chat/:sessionId 会话忙返回 429
  arrange: session isBusy=true
  act: POST { text: "query" }
  assert: 429 { error: "Session is busy" }

test: POST /api/chat/:sessionId 创建会话失败返回 500
  arrange: AI_API_KEY 缺失
  act: POST { text: "query" }
  assert: 500 { error: 含 "API_KEY" }
```

#### Dashboard API (`dashboard.test.ts`)

```
test: GET /api/dashboard 返回正确结构
  act: GET /api/dashboard
  assert: 200 { summary: { totalOrders, inProgressCount, ... }, bases: [...], warnings: [...] }

test: SQL 不可用时降级到 Prisma
  arrange: SQL_HOST=invalid
  act: GET /api/dashboard
  assert: 200, usingRealData=false
```

### Guarded-Live 测试（需要 LLM API + SQL Server）

```
test: Agent 拒绝超出职责范围的问题
  act: prompt("今天天气怎么样")
  assert: 回复含拒绝语（无工具调用），而非天气预报

test: Agent 缺信息时追问
  act: prompt("帮我查一下进度")
  assert: 回复追问"请提供订单号"

test: 订单查询返回 SQL Server 真实数据
  act: prompt("查 ZS-2026-001 在中试广州的进度")
  assert: tool_start → query_order_progress, text_delta 含订单详情
```

---

## 建议 CI 门禁

```yaml
# .github/workflows/test.yml（建议）
name: Test
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  deterministic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test --workspace=pi_agent    # 单元测试
      - run: npm test --workspace=server      # 集成测试（mock server）
      - run: npm test --workspace=web         # 前端测试

  # guarded-live: 仅手动触发，不参与 PR 检查
  # run: gh workflow run guarded-live-tests.yml
```

**分支保护**: 要求 `deterministic` 检查通过才能合并到 `main`。

---

## 缺口 — 已记录但未验证

按泄露暴露严重程度排序：

| 排名 | 规则 | 违反后果 | 无测试原因 |
|------|------|---------------------|-----------------|
| 1 | Planner 基地限制在运行时执行 | 敏感订单跨基地数据泄露 | 无单元测试；仅可手动验证 |
| 2 | SQL 注入防御（参数化查询） | 生产数据库被攻破 | 工具级测试已在上方提出，但未编写 |
| 3 | Session API 鉴权 | 会话历史可被任何人读取 | 鉴权中间件尚未实现 |
| 4 | 错误消息不泄露数据库 schema | 信息泄露辅助攻击者 | 错误格式化靠人工，无自动检查 |
| 5 | Mock 降级时明确标注"模拟数据" | 用户基于错误数据决策 | UI 层面问题，需视觉回归或人工检查 |
| 6 | LLM 工具调用路由准确率 | 调用错误工具，返回错误答案 | 本质非确定性；需 eval harness，非单元测试 |
| 7 | Dashboard 缓存正确性 | 展示过期数据 | 缓存层尚未实现 |
