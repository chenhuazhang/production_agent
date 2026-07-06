# 业务流程：中试 AI 助手

每个流程记录信任边界跨越、鉴权检查和副作用。

---

## 流程 1：订单进度查询（核心流程）

**角色**: 业务员 / 工程师 / 计划岗
**触发**: 用户在聊天框输入订单号

```
步骤 1: HTTP POST /api/chat/:sessionId
  - 鉴权: 无 (⚠️ 当前无验证，body.user 被直接信任)
  - 输入: { text: "查 ZS-2026-001", user?: UserContext }
  - 跨越信任边界: 不可信用户输入 → 服务端

步骤 2: AgentSession.prompt(text)
  - LLM 收到: system prompt (AGENTS.md + 3 SKILL.md) + 用户文本
  - LLM 决策: 路由到 query_order_progress 工具
  - 信任边界: LLM 输出（不可信）→ 工具选择决策

步骤 3: 工具执行: query_order_progress
  - checkPermission("query_order_progress", { order_no, base? })
    ├── 第 0 步: requireCurrentUser() — ALS 上下文
    ├── 第 1 步: DENY_ALWAYS 前缀检查（写操作拦截）
    ├── 第 2 步: 工具白名单检查（TOOL_PERMISSIONS）
    ├── 第 3 步: 角色检查（sales / engineer / planner / supervisor）
    └── 第 4 步: 参数检查（planner 仅限本基地）
  - 允许 → SQL 查询
  - 拒绝 → { error: reason }

步骤 4: SQL Server 查询
  - 参数化查询 @orderNo
  - 4 个基地并行查询 (Promise.all)
  - 信任边界: 服务端 → 外部数据库
  - 副作用: 只读，无数据变更

步骤 5: 工具结果 → LLM 格式化 → SSE 流
  - text_delta: 格式化回答
  - tool_start / tool_end: 查询元数据
  - done: 流结束
  - 副作用: ExecutionTracer 写入 JSONL 日志
```

---

## 流程 2：产能负荷分析

**角色**: 工程师 / 计划岗 / 主管
**触发**: 用户询问"各基地负荷怎么样"

```
步骤 1-2: 同流程 1（HTTP → LLM 路由）

步骤 3: 工具执行: analyze_capacity
  - checkPermission("analyze_capacity", { base_name? })
    └── planner 限制本基地
  - 尝试 SQL: getRealTimePendingCounts(90) — 3 次顺序查询
    ├── 广州中试: SELECT COUNT ... FROM tabdiytable3393
    ├── 小试: SELECT ... FROM tabdiytable5992 GROUP BY base
    └── OA辅助单: SELECT ... FROM tabdiytable8460 GROUP BY base
  - 降级: getPendingOrdersByBase() 从 mock 数据
  - 计算: dailyCapacity, loadRate, overloadMultiplier, daysToComplete
  - 信任边界: mock vs SQL 真实数据 — 用户看到 data_source 标注

步骤 4-5: 同流程 1
```

---

## 流程 3：下单基地推荐 + 交期估算

**角色**: 业务员
**触发**: 用户询问"推荐去哪个基地"或"XX基地下单要多久"

```
步骤 1-2: 同流程 1

步骤 3: 工具执行: recommend_base / estimate_delivery
  - checkPermission（同上模式）
  - ⚠️ 当前限制: 两个工具均只使用 mock 数据
    （analyze_capacity 有 SQL 路径；这两个没有 — 不一致）
  - recommendBase: 按 loadRate 排序 → 选最低的
  - estimateDelivery: (待处理 + 新单量) / 日产能 → 天数

步骤 4-5: 同流程 1
```

---

## 流程 4：搜索订单

**角色**: 业务员 / 工程师
**触发**: 用户只记得客户名或产品名

```
步骤 1-2: 同流程 1

步骤 3: 工具执行: search_orders
  - checkPermission（同上模式）
  - ⚠️ 当前限制: 仅 mock 数据（MOCK_ORDERS 数组）
  - 未接入 SQL Server 真实搜索
```

---

## 流程 5：生产执行看板

**角色**: 任意用户（⚠️ 当前无鉴权）
**触发**: 用户打开 /dashboard 页面

```
步骤 1: 浏览器 → GET /api/dashboard
  - 鉴权: 无

步骤 2: Next.js API route 处理
  - 尝试 SQL: fetchAllDashboardOrders(30)
    ├── 3 个查询顺序执行（⚠️ 应改为并行）
    └── 上海查询: 仅基础字段（无异常、无人员 — 已知限制）
  - 降级: Prisma SQLite seed 数据
  - 处理: 按基地分组 → 计算 KPI → 过滤逾期/预警 → Top 5 排序

步骤 3: JSON 响应 → React 组件
  - DashboardKpiCards, BaseOrderCard, DeliveryWarnings
```

---

## 流程 6：会话历史

**角色**: 任意用户（⚠️ 当前无鉴权）
**触发**: 用户打开侧边栏，点击会话

```
GET /api/sessions → SessionManager.list(cwd) → 按修改时间倒序
GET /api/sessions/:sessionId → 读取 JSONL 文件 → 解析 entries → 提取消息
DELETE /api/sessions/:sessionId → 删除文件

⚠️ 无鉴权、无所有权检查 — 任意用户可读取/删除任意会话
```

---

## 副作用清单

| 流程 | 副作用 | 持久化 | 回滚 |
|------|-------------|----------|--------|
| 聊天（全部工具） | ExecutionTracer 写 JSONL | data/logs/traces/{日期}.jsonl | 追加写，无需回滚 |
| 聊天（全部工具） | SessionManager 追加会话 JSONL | ~/.pi/agent/sessions/{id}.jsonl | 追加写 |
| 创建会话 | SessionStore 添加内存条目 | 仅内存（30min TTL） | GC 超时清理 |
| 删除会话 | fs.unlinkSync 删除 JSONL | 永久删除 | 不可回滚 |
| 看板 | 只读 SQL + Prisma 读 | 无 | N/A |
| 全部 | console.log 输出 | stdout（不持久化） | N/A |
