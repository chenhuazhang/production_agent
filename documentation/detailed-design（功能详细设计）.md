# 功能详细设计（Detailed Design）

> 本文档是**当前已实现功能**的详细设计说明，覆盖 Agent 工具层、SQL Server 数据层、权限/上下文、业务范围分流、模型装配与降级、会话管理、服务端接口、Web 前端、数据模型与关键设计决策。
>
> 范围：以「已落地代码」为准（`pi_agent/`、`server/src/`、`web/src/`），不含规划中的能力。功能成熟度与遗留问题见 [feature-status（功能现状盘点）](../reports/feature-status（功能现状盘点）.md)，总体架构见 [architecture（系统架构）](architecture（系统架构）.md)。

## 目录

1. [总体结构与分层](#1-总体结构与分层)
2. [Agent 工具层](#2-agent-工具层)
3. [SQL Server 数据层](#3-sql-server-数据层)
4. [权限与用户上下文](#4-权限与用户上下文)
5. [业务范围分流（多智能体）](#5-业务范围分流水多智能体)
6. [模型装配与额度降级](#6-模型装配与额度降级)
7. [会话管理与持久化](#7-会话管理与持久化)
8. [服务端接口](#8-服务端接口)
9. [Web 前端](#9-web-前端)
10. [数据模型与字段映射](#10-数据模型与字段映射)
11. [关键设计决策与权衡](#11-关键设计决策与权衡)

---

## 1. 总体结构与分层

```
web (Next.js)  ──SSE/REST──▶  server (Hono)  ──createSession──▶  pi_agent (Agent)
     │                              │                               │
     │ /api/dashboard               │ /api/chat /api/sessions       │ tools（7 个）
     │ /api/bases /api/capacity     │ /v1/* (MaxKB)                 │ skills（3 个）
     │ 直连 SQL（看板）             │ /open/* (外部系统)             │ services/（SQL/权限/上下文）
     ▼                              ▼                               ▼
  PostgreSQL(看板seed)       SessionStore / Tracer           SQL Server（生产 ERP）
```

- **Agent 核心**：`pi_agent/`，基于 `@earendil-works/pi-coding-agent`。
- **Agent 服务**：`pi_agent/agent/services/`（`sqlServer.ts`、`permissionGuard.ts`、`userContext.ts`）。
- **数据与技能**：`pi_agent/data/`（mock 数据、产能算法）、`pi_agent/agent/skills/`（3 个 SKILL.md）。
- **后端服务**：`server/src/`，Hono + SSE。
- **前端**：`web/src/`，Next.js App Router。

---

## 2. Agent 工具层

### 2.1 工具定义与返回协议

所有工具用 `defineTool({ name, label, description, parameters, execute })` 定义，参数 schema 用 `TypeBox`（`@sinclair/typebox`）声明。工具清单 `agentTools`（7 个），`TOOL_NAMES = agentTools.map(t => t.name)` 作为 `createAgentSession` 的 `tools` 白名单——**LLM 只能调用这 7 个领域工具，无 filesystem/shell/network**。

每个 `execute` 开头先做权限检查，再执行业务。统一返回协议：

```ts
// textResult(details) → { content: [{ type: "text", text: JSON.stringify(details) }], details }
```

`details` 是结构化结果（订单行、统计、错误提示等），JSON 序列化后供 LLM 阅读并转述；`details` 同时作为 `tool_end` 事件里的 `result` 原样透传前端展示（`ToolResultCard`）。

### 2.2 七个工具逐个设计

| 工具 | 参数 | 数据源 | 关键行为 |
|------|------|--------|----------|
| `query_order_progress` | `order_no`(必填)、`base`(可选) | SQL 点查 | 未传 base → `queryOrderProgressMany` 并行查 5 类取命中；主表未命中 → 降级 `queryPendingOrder`（登记表）；再查无 → 提示；SQL 异常 → 降级 mock |
| `query_orders_list` | `technician`/`base`/`grade`/`product_line`/`business_types`/`since`/`until`（均可选） | SQL 列表 | 别名展开 → 业务范围钳制 → 无过滤条件默认 90 天窗口 → 三路统计（明细/总数/产品线）；SQL 失败**无 mock**，直接报错 |
| `search_orders` | `keyword` | mock | 按订单号/客户/产品名过滤 `MOCK_ORDERS` |
| `get_production_stages` | 无 | 静态常量 | 返回 `PRODUCTION_STAGES` 工序列表 |
| `analyze_capacity` | `base_name`(可选) | SQL 待处理数 + mock 设备配置 | `getRealTimePendingCounts(90)` 取真实待处理，`BASE_CONFIGS` 取设备产能，`analyzeBaseCapacity` 计算负荷 |
| `recommend_base` | 无 | mock | 各基地 `analyzeBaseCapacity` + `recommendBase`（负荷率最低） |
| `estimate_delivery` | `base_name`(必填)、`order_quantity`(可选) | mock | `estimateDelivery` 估算交期天数 |

### 2.3 意图路由（AGENTS.md）

系统提示 = `AGENTS.md` + 3 个 SKILL.md 正文 +（可选）业务范围说明 `scopeNote`。AGENTS.md 提供「问法 → 工具」映射表，SKILL.md 提供行为规范（何时调哪个工具、结果如何解读与排版）。三者由 `session.ts` 的 `buildSkillPromptBlocks()` 在服务端直接拼接进 `appendSystemPrompt`——**框架的 `<available_skills>` 需要 read 工具加载技能文件，但本 Agent 白名单无 read 工具，因此 SKILL.md 必须由服务端注入**（见 §11 决策）。

---

## 3. SQL Server 数据层

`pi_agent/agent/services/sqlServer.ts` 是所有真实数据查询的唯一入口（纯只读、@param 参数化，不依赖 Agent 框架）。

### 3.1 连接池

单例连接池，懒加载（`getPool()`）：`encrypt=false`、`trustServerCertificate=true`（内网自签名），`connectTimeout 10s`、`requestTimeout 30s`，`pool.max=10`。连接错误时置空 `_pool` 允许下次重建。`closePool()` 供进程退出清理。

> 关键：工具层 SQL 失败会降级 mock；开放接口（/open）直连本数据层，**不经工具层**，保证外部系统绝拿不到 mock 数据。

### 3.2 业务类型与别名

`BaseName` 5 类：`广州工艺实验`、`广州送样&小订单`、`小试`、`上海工艺实验`、`OA辅助单`。

`resolveBusinessTypes(inputs?)` 将自然语言别名归一为正式类型集；未知输入抛错并附可用清单。别名表 `BUSINESS_TYPE_ALIASES` 的关键口径：

| 别名 | 映射 |
|------|------|
| 研发实验 | 小试 |
| 工艺实验 | 广州工艺实验 + 上海工艺实验 |
| 注塑单 / 研发辅助单 | OA辅助单 |
| 送样 / 小订单 | 广州送样&小订单 |
| 实验单 / 实验 | 广州工艺实验 + 上海工艺实验 + 小试 + **OA辅助单**（研发辅助单也要计入） |
| 所有单 / 全部 / 下单 | 全部 5 类 |

### 3.3 数据窗口（3 个月硬限制）

所有查询只查「最近 3 个月内有工序活动」的订单，服务端 `DATEADD(MONTH,-3,GETDATE())` 计算。因排产时间填充率极低（广州约 6%），每类用**多个高填充率时间列的 OR** 定义窗口：

| 类型 | 窗口谓词（字段） |
|------|------------------|
| 广州两类 | 开单 / 色粉计量 / 混料 / 挤出 / 最终完成 / 排产（6 列 OR） |
| 小试 | 排产 / 混料 / 挤出 / 注塑完成（4 列 OR） |
| 上海工艺实验 | 头表色粉计量 OR 排产 |
| OA辅助单 | 排产 / 注塑样条 |

### 3.4 点查：5 套 SQL 模板 + 工序语义装饰

`SQL_TEMPLATES` 每业务类型一套点查 SQL，全部仅需 `@orderNo` 一个参数（业务类型靠订单号模式区分）。字段表与表结构见 §10。

点查流程：
1. `queryOrderProgress(orderNo, base)` → 执行模板 SQL → `recordset`；
2. `normalizeRowDates(row)`：把 `Date` 与 `TIME_FIELD_KEYS` 白名单里的时间字段统一归一——`formatSqlDatetime` 把驱动按 UTC 解释的 `Date` 还原为库中墙钟 `YYYY-MM-DD HH:mm`；`1900/1899` 哨兵日期与空串一律归 `null`（= 未记录）；
3. `decorateProgressRow(base, row)` 补工序语义字段（纯函数，可单测）：

   - `stages[]`：各工序 `{ node, person, time, done }`，由 `STAGE_SPECS[base]` 定义（见 §10 工序表）；
   - `status`：`已完成` / `生产中`，按 `COMPLETE_KEY[base]` 完成信号字段判定（小试=注塑完成时间、OA=注塑样条时间，其余=最终完成时间）；
   - `current_stage` / `current_stage_person`：生产中时 = 最后一个已完成工序的下一步；全程无记录时 = 第一个做工节点；完成时为 `null`。

> `current_stage` 由数据层按业务规则算好，外部对接方直接展示即可，不要再按时间自行推断（源 ERP 里色粉计量等时间列记录率仅约 3.6%，「第一个未完成工序」推算法会把绝大多数订单误判停在色粉称量）。

`queryOrderProgressMany(orderNo, bases)` 用 `Promise.all` 并行多类型点查，单类型失败落入 `error` 字段不抛。

### 3.5 未排产订单（登记表兜底）

排产前订单只登记在两张登记表、不进主表：

- `tabdiytable7367`（工艺实验 / 小试，订单号 `F126876`）；
- `tabdiytable7293`（OA辅助单，订单号 `F125422`）。

`queryPendingOrder(orderNo)` 两表并行精确命中，返回 `status:"待排产"` 与 `records[]`（`source` / `order_no` / `technician` / `grade` / `base` 地域 / `registered_at`）。登记阶段无法区分工艺实验 vs 小试，只报地域与登记信息。牌号取自拼接串 `F126820` 第一个下划线前段。

### 3.6 订单列表查询（多维）

`ORDER_LIST_SPECS` 为每业务类型声明「摘要列 / FROM+最小 JOIN / 过滤列 / 完成判定」，点查与列表解耦——列表不查工序人员（无 CROSS JOIN / ROW_NUMBER），更轻。关键字段：

- `select`：5 类统一形状摘要列（`order_no`/`base`/`machine`/`technician`/`tech_remark`/`grade`/`product_line`/时间列/`status` CASE/异常列）；
- `techFilter`：`column`（技术员独立列）或 `remark`（上海工艺实验技术员写进「技术配方备注」文本，模糊匹配备注）；
- `implicitBase`：固定基地类型（广州两类→广州、上海工艺实验→上海）；`baseCol`：全集团类型（小试/OA）的基地列；
- `timeFallbackCol`：排产时间为空（1900 哨兵/NULL）时 `since/until` 回退到的备用时间列（通常为开单时间），避免排产填充率低导致整批漏单；
- `completedExpr`：完成时返回订单号、否则 NULL，供 `COUNT(DISTINCT ...)` 统计已完成数。

`buildListWhere(spec, filters)` 动态拼 WHERE：恒加 `pattern`（订单号 + 业务类型判别式）与 `windowPredicate`（3 个月窗口），再按需追加 `technician`/`base`/`grade`/`product_line`/`since`/`until`——**所有用户输入一律 `@param` 绑定，LIKE 用 `N'%' + @param + N'%'`**。日期过滤用 `CASE WHEN 排产空 THEN 备用列 ELSE 排产 END`，`until` 取「次日 00:00」为开区间上界。

三类查询构建器（共用同一套 WHERE 保证口径一致）：

- `buildOrderListQuery`：`SELECT DISTINCT TOP (@limit) ... ORDER BY scheduling_time DESC`（明细，默认 200 条截断）；
- `buildOrderListCountQuery`：`COUNT(DISTINCT orderNo) AS total, COUNT(DISTINCT completedExpr) AS completed`（真实总数，不截断）；
- `buildOrderListLineCountQuery`：`GROUP BY 产品线`（空产品线归入 `(未指定产品线)`），用于精确回答「各产品线分别多少单」。

`queryOneTypeForList` 三路并行执行明细/总数/产品线统计；固定基地类型与请求基地不符时**跳过不发 SQL**并记 `skipped`。非上海类型按订单号去重（JOIN 可能复制行），上海类型走 `aggregateOrderLots`（见下）。`queryOrdersList` 用 `Promise.all` 并行多类型，单个失败落 `error` 不影响其他；`total` 为各类型命中数之和。

**上海一单多料次聚合**（`aggregateOrderLots`）：一个订单多个料次（`order_count`=料次号）各占一行，整单完成以**料次号最大者**为准（最后料次最终班长完成即整单完成）；聚合结果每订单一行，异常取各料次并集，附 `lot_total`/`lot_completed`。统计完成的 `completedExpr` 依赖派生表 `ml.max_lot`（`(SELECT f96425, MAX(f96426) max_lot ... GROUP BY f96425)`），避免在 `COUNT(DISTINCT CASE ...)` 内嵌 `SELECT MAX` 触发 SQL Server error 130「聚合套聚合」。

### 3.7 实时产能统计

`getRealTimePendingCounts(sinceDays=90)` 聚合三个数据源（上海中试 JOIN 太慢暂未纳入）：

- 广州中试（`tabdiytable3393`，`f53419` 为完成信号）；
- 小试（`tabdiytable5992` 按 `f102925` 基地分组，`f102963` 完成信号）；
- OA辅助单（`tabdiytable8460` JOIN `8459`，`f138978` 完成信号）。

每个数据源单独 try/catch，失败 warn 并跳过；输出 `CapacitySnapshot[]`（`baseName`/`pendingOrders`/`completedOrders`/`totalOrders`）。

---

## 4. 权限与用户上下文

### 4.1 用户上下文（`userContext.ts`）

`AsyncLocalStorage<UserContext>` 在每次请求的 `runWithUser()` 上下文中传递身份，工具执行时 `getCurrentUser()` 读取。`UserContext`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | string | CRM 用户 ID |
| `role` | `sales`/`engineer`/`planner`/`supervisor` | 业务员/技术工程师/计划岗/主管+ |
| `baseId` | string \| null | 计划岗归属基地；主管为 null（全部基地） |
| `allowedBusinessTypes?` | BaseName[] | 业务范围钳制（多智能体分流），undefined=不限 |

### 4.2 权限检查（`permissionGuard.ts`）

`checkPermission(toolName, args)` 四步：

- **Step 0**：`requireCurrentUser()` 未认证直接抛错；
- **Step 1**：`DENY_ALWAYS = ["update_","delete_","write_","modify_","execute_sql","run_command"]` 前缀硬拦截，命中即拒；
- **Step 2**：`TOOL_PERMISSIONS[toolName]` 白名单，未知工具仅 supervisor 放行；
- **Step 3**：角色集合校验；
- **Step 4**：`paramCheck` 参数级约束——计划岗（`planner`+`baseId`）只能查本基地（`base`/`base_name` 参数须等于 `baseId`）。

7 个工具全部 `allowRoles: ["sales","engineer","planner","supervisor"]`（即四角色均可读），差异化只在计划岗的基地约束。

> ⚠️ 当前鉴权未接入：`chat.ts` 里未传 `user` 时用 `ANON_USER(role="supervisor")`，`body.user` 可伪造，生产前必须替换（见 feature-status 🔴）。

---

## 5. 业务范围分流（多智能体）

企业微信机器人 A/B 各绑定一个 MaxKB 应用 → 应用模型名不同 → 服务端按 `body.model` 路由业务范围。

`scopes.ts` 定义三个 `BusinessScope`：

| 模型名（/v1 收到的 model） | scope key | 允许业务类型 |
|------|-----------|--------------|
| `production-agent` | all | 全部 5 类 |
| `production-agent-gz` | gz-sample | 仅 广州送样&小订单 |
| `production-agent-main` | main | 广州工艺实验 / 小试 / 上海工艺实验 / OA辅助单 |

`resolveScopeByModel(model)`：未知模型名回退 `all`（兼容旧配置）。分流在三处落地：

1. `scope.note` 注入系统提示（`appendSystemPrompt`）；
2. `maxkbUser.allowedBusinessTypes = scope.types` 传入 ALS；
3. 工具层（`query_order_progress` / `query_orders_list`）在参数校验后按 `getCurrentUser()?.allowedBusinessTypes` 钳制查询范围，越界返回「本助手不支持业务范围 XX」提示。

---

## 6. 模型装配与额度降级

### 6.1 环境配置

`config.ts#getEnvConfig()` 读 `AI_PROVIDER`（默认 `bailian`）、`AI_API_KEY`、`AI_MODEL`（默认 `qwen3.8-max`）。缺 Key 抛错。

`getModelFallbackChain()` 生成 `[AI_MODEL, ...AI_MODEL_FALLBACKS]`（默认追加 `glm-5.2,qwen3.7-max`），去重保序。

### 6.2 Session 装配（`session.ts#createSession`）

1. `AuthStorage` 写入 provider/apiKey；`ModelRegistry` 装配；
2. `resolveModelChain` 按降级链解析为 `Model[]` 实例（解析失败抛错，避免运行时才发现缺配置）；
3. `DefaultResourceLoader` + `skillsOverride` 合并 3 个 SKILL，`appendSystemPrompt` 注入 SKILL 正文与 `scopeNote`；
4. `createAgentSession({ model: modelChain[0], thinkingLevel:"low", customTools: agentTools, tools: TOOL_NAMES, sessionManager })`。

`thinkingLevel:"low"` 启用思考链，reasoning 模型的 `thinking_delta` 已转发前端展示。

### 6.3 额度降级执行器（`modelFallback.ts`）

阿里云百炼每模型独立免费额度，额度用尽时 API 报「额度类错误」。`runPromptWithModelFallback`：

1. 逐模型 `session.setModel(target)` → `executeTurn`；
2. `executeTurn` 订阅原始事件：`message_end(stopReason="error")` 时暂存错误并 `suppressed=true`，此后该回合剩余事件（含失败回合 `agent_end`）**全部吞掉不转发**；
3. 回合结束按错误判定：`isQuotaExhaustedError(message)`（正则匹配 quota/exhausted/欠费/额度不足/未开通/免费额度等）命中 → 返回 `quota`，切下一个模型重跑；非额度错误 → 立即返回 `error`；
4. 全部模型额度用尽 → `error`（列出整条链供提示续费）。

事件时序保证 `message_end(error)` 先于 `agent_end`，避免客户端看到失败轮次的事件。

---

## 7. 会话管理与持久化

### 7.1 Agent 会话（`session.ts`）

- 新建：`SessionManager.create(cwd)`；续聊：`SessionManager.open(sessionFile)`（恢复全部历史消息）；均持久化 JSONL 文件，默认启用 Compaction 上下文自动压缩。
- `cwd` 固定为项目根目录（`server/index.ts` 的 `AGENT_CWD`），并把 `PI_CODING_AGENT_DIR` 指到项目内 `.pi/agent`，避免用户目录权限问题与会话目录分裂。

### 7.2 内存会话存储（`sessionStore.ts`）

`SessionStore` 内存 Map 管理 `AgentSession`：

- `getOrCreate(sessionId, opts?)`：命中缓存即返回并刷新 `lastActiveAt`；否则判断是否续聊——`sess-`（前端临时 id）/`maxkb-`（MaxKB 无状态）前缀直接新建，否则按真实会话 id 查 `SessionManager.listAll()` 找到文件路径 `SessionManager.open` 恢复；
- `isBusy`/`setBusy`：同会话并发保护（忙时返回 429）；
- `cleanup()`：每 5 分钟清理 `lastActiveAt` 超过 30 分钟的会话并 `dispose`。

---

## 8. 服务端接口

`server/src/index.ts` 注册 Hono 路由 + CORS + 两个鉴权中间件，监听 8001（dev）。

### 8.1 `POST /api/chat/:sessionId`（SSE 聊天）

请求体 `{ text, user? }`。链路：
1. 校验 JSON / text 非空；`store.isBusy` → 429；
2. `store.getOrCreate(sessionId)`（失败返回带消息 500，避免裸 500）；
3. 响应头回传持久化 id `X-Session-Id`（首条消息后前端用真 id 替换临时 `sess-` id）；
4. `streamSSE` + `runPromptWithModelFallback`，`onEvent` 同时喂 `tracer.record` 与 SSE 转发。

SSE 事件协议：

| event | data |
|-------|------|
| `text_delta` | `{ delta }` |
| `thinking_delta` | `{ delta }` |
| `tool_start` | `{ toolName, args }` |
| `tool_end` | `{ toolName, isError, result }` |
| `done` | `{}` |
| `error` | `{ message }` |

`agent_end` 到达时（成功结束）在 `done` 前补一条**反馈页脚** `text_delta`（`REPLY_FOOTER`，幂等只发一次），页脚只发前端不写回会话历史。

### 8.2 `/api/sessions/*`（会话管理）

- `GET /` 列表（读 `data/session-meta.json` 置顶信息，置顶排前）；
- `GET /pinned` 置顶 map；
- `GET /:sessionId` 单会话消息（`parseSessionEntries` + 乱码清理）；
- `PATCH /:sessionId/rename` 重命名（向 JSONL 追加 `session_info` 条目）；
- `DELETE /:sessionId` 删除（`unlinkSync` + 清置顶）；
- `PATCH /:sessionId/pin` 置顶/取消。

### 8.3 `/v1/*`（OpenAI 兼容，MaxKB 接入）

- 鉴权：`SYNC_API_KEY` Bearer 中间件（未配置则放行但打警告，仅开发）；
- `GET /v1/models`：虚拟模型列表（`production-agent` / `production-agent-gz` / `production-agent-main`）；
- `POST /v1/chat/completions`：
  - `buildPromptFromMessages` 把 MaxKB 的 messages 拼成 prompt（忽略 system；user/assistant 历史用 `用户：`/`助手：` 前缀拼接；历史助手消息先 `stripReplyFooter` 剥掉页脚防重复）；
  - 按 `body.model` 解析 scope → `sessionId = maxkb-<uuid>`（无状态，跑完销毁）→ 创建会话；`maxkbUser = supervisor + allowedBusinessTypes=scope.types`；
  - `stream=true` → `runPromptStream` 按 OpenAI SSE `chat.completion.chunk` 协议推送，结束后销毁 session；同步 → `runPromptSync` 聚合文本返回 `chat.completion` JSON（`usage` 全 -1 让 MaxKB 不依赖计费）。

### 8.4 `/open/*`（对外开放接口）

- 鉴权：独立 `OPEN_API_KEY` Bearer 中间件，**fail-closed**——未配置 key 时 `/open/*` 一律 503（对外订单数据宁可不服务也不裸奔）；
- `GET /open/orders/progress?order_no=&base=`：`order_no` 必填（长度 ≤64 卫生校验）、`base` 支持别名/逗号/重复参数 → `queryOrderProgressMany` 直连数据层（无 mock）→ 状态分拣：命中≥1 → 200（多命中附 note、部分失败附 warnings）；全查无 → 404；全 SQL 失败 → 500（不谎报「未找到」）；
- `GET /open/orders/list?...`：多维过滤（`technician`/`base`/`grade`/`product_line`/`since`/`until`/`limit`≤1000），数据窗口仍由数据层强制 3 个月；
- 审计：每次请求落盘 `data/logs/open-api-requests.jsonl`（含 401 鉴权失败，用于发现暴力探测）。

### 8.5 日志与链路（`executionTracer.ts`）

每次对话一条 `ExecutionTrace`（追溯 id / 会话 / 用户输入 / 汇总文本 / 工具步骤（各带耗时）/ 总耗时 / 错误），`finish`/`error` 时落盘 `data/logs/traces/{YYYY-MM-DD}.jsonl`。

---

## 9. Web 前端

### 9.1 聊天链路（`web/src/lib/ai-client.ts`）

`sendChatMessageStream(sessionId, request, handlers)` 消费 SSE：手写解析器按 `\n\n` 分隔事件块，分发 `onTextDelta`/`onThinkingDelta`/`onToolStart`/`onToolEnd`/`onDone`/`onError`；从响应头 `X-Session-Id` 回调 `onSessionId` 绑定真实会话。服务端地址 `AI_API_URL`（默认 `http://127.0.0.1:8001`，浏览器侧空值走 Next.js rewrites 代理）。

### 9.2 会话定位（`web/src/lib/sessions.ts` + `sessionContext.tsx`）

`fetchSessionList`/`fetchSessionHistory`/`deleteSession`/`renameSession`/`pinSession` 封装 `/api/sessions/*`；`sessionContext.tsx` 维护前端会话列表、当前会话、置顶状态。

### 9.3 生产看板

- `web/src/lib/sqlServer.ts`：直连 SQL 查 5 数据源（广州两类自 `2026-04-01` 按是否含 EX 拆分、上海工艺实验、小试、OA辅助单），`dedupeByOrderNo` 去重、`aggregateShanghaiOrders` 上海料次聚合、`mapBaseName` 基地名映射、`isEx`/`strOrNull` 值清洗；
- `web/src/app/api/dashboard/route.ts`：`fetchAllDashboardOrders(30)` 取真实数据，失败降级 Prisma（PostgreSQL）seed；随后按 `baseName|dataSource` 分组，计算 KPI（生产中/已完成/逾期/预警/异常）、工序分布（`determineCurrentStage`）、Top5 活跃订单、交期估算（`determineDeliveryDate`：已完成=完成时间，否则排产+7 天 / 开单+10 天）、全局预警（逾期/2 天内交期，按逾期天数排序取 Top10）。

### 9.4 基地与产能页

- `web/src/app/api/bases/route.ts`：Prisma `base` 表 GET 列表 / POST 新增；
- `web/src/app/api/capacity/route.ts`：Prisma `base`+最新 `snapshot` 计算负荷（`daily_capacity = machineCount × perMachineDailyOutput` 等），查不到回退硬编码 mock。

### 9.5 页面与组件

页面：`/dashboard`、`/chat`、`/bases`、`/capacity`。组件分 `chat/`（`ChatPanel`/`MessageList`/`MessageInput`/`ToolResultCard`）、`dashboard/`（`DashboardKpiCards`/`BaseOrderCard`/`DeliveryWarnings`/`ProcessStageList`/`StatusBar`）、`capacity/`（`CapacityChart`）、`layout/`（`Sidebar`）、`ui/`（`button`/`card`/`badge`/`input` 等）。

---

## 10. 数据模型与字段映射

### 10.1 SQL Server 源表 ↔ 业务类型

| 业务类型 | 主表（头表） | JOIN 表 | 订单号列 | 订单号模式 |
|------|------|------|------|------|
| 广州工艺实验 | `tabdiytable3393` | `3946`(样条时间)、`7367`(技术员/产品线) | `f52977` | 含 EX |
| 广州送样&小订单 | `tabdiytable3393` | 同上 | `f52977` | 不含 EX |
| 小试（全集团） | `tabdiytable5992` | `7367`(技术员)、`3439`(人员 ROW_NUMBER, `ID='342019838'`) | `f102935` | 含 EX |
| 上海工艺实验 | `tabdiytable5724` | `5698/5699/5707/5711/5625/5690`(各方工序) | `t2.f96425` | EX 开头 |
| OA辅助单（全集团） | `tabdiytable8460` | `8459`(基地)、`3439`(人员) | `f138799` | 无 |

> 上海工艺实验技术员无独立字段，记录在「技术配方备注」`t8.f95728`，回答时从备注文本提取。

### 10.2 工序列表（`STAGE_SPECS`）

| 业务类型 | 做工工序顺序 |
|------|------|
| 广州工艺实验 / 广州送样&小订单 | 色粉计量 → 混料 → 挤出 → 注塑色板 → 注塑样条 → 最终班长 |
| 小试 | 色粉计量 → 混料 → 挤出 → 注塑样条（无注塑色板；完成信号=注塑完成时间） |
| 上海工艺实验 | 色粉计量 → 混料 → 挤出 → 注塑色板 → 注塑样条 → 最终班长（每料次单独） |
| OA辅助单 | 注塑（仅一道） |

### 10.3 看板本地库（PostgreSQL，`web/prisma/schema.prisma`）

| 模型 | 表 | 关键字段 |
|------|------|----------|
| `Base` | bases | name / location / dataSource（业务类型）/ machineCount / perMachineDailyOutput / active |
| `CapacitySnapshot` | capacity_snapshots | baseId / pendingOrders / dailyCapacity / loadRate / overloadMultiplier / daysToComplete / snapshotDate |
| `Order` | orders | orderNumber(unique) / machine / orderCount / status / deliveryDate / currentStage / 3 个异常布尔 |
| `ProcessStage` | process_stages | orderId / name / status / person / completedAt / sortOrder |
| `Conversation` / `Message` | conversations / messages | 预留的会话/消息表（当前会话持久化实际走 Agent JSONL，未用此表） |

---

## 11. 关键设计决策与权衡

1. **数据窗口「3 个月」硬限制 + 多列 OR**：排产时间填充率极低（广州约 6%），若只按排产时间过滤会误伤大量近期活跃订单，故每类用「多个高填充率时间列 OR」界定窗口；对外一致口径，查不到时如实告知窗口限制而非断定订单不存在。
2. **排产时间回退（`timeFallbackCol`）**：列表 `since/until` 过滤时，排产为空回退到开单/其他活动时间，避免「加时间过滤就整批漏单」。
3. **哨兵日期统一归一**：`1900/1899` 与空串一律归 `null`，「未设置」绝不作为真实完成时间交给外部系统（否则对接方据此误判「已完成/当前工序」）。
4. **`current_stage` 由数据层算好**：源 ERP 时间列记录率仅 ~3.6%，「第一个未完成工序」推算法不可靠，故在数据层按业务规则补 `status/stages/current_stage`，对接方只展示不推断。
5. **SKILL.md 直接注入系统提示**：框架技能机制需 read 工具加载，本 Agent 白名单无文件访问，故由 `buildSkillPromptBlocks` 服务端直读注入，等价「系统提示 = AGENTS.md + 3 SKILL.md」。
6. **工具层降级 mock、开放接口直连数据层**：工具层 SQL 失败降级 mock（保证对话有回退），但这与「外部系统要真实数据」冲突，故 `/open` 直连 `sqlServer.ts` 纯查询函数，绝不经工具层。
7. **上海料次聚合 + 派生表 `ml.max_lot`**：「整单完成以最后料次为准」业务规则；统计在 `COUNT(DISTINCT CASE...)` 里内嵌 `SELECT MAX` 会触发 SQL Server error 130，故单独派生表提供 `max_lot`。
8. **额度降级独立成执行器**：同端点同 Key、各模型独立额度，额度用尽按链切换；失败回合事件吞掉不转发，客户端看不到失败轮次。
9. **MaxKB 无状态会话**：每次请求临时 `maxkb-` sessionId，历史由 MaxKB 通过 messages 传入，跑完即销毁；`stripReplyFooter` 防页脚在多轮复述。
10. **开放接口 fail-closed**：`/open` 未配 `OPEN_API_KEY` 一律 503，宁可不可用也不裸奔（与 `/v1` 的「未配置放行」刻意区分信任域）。

---

## 关联文档

- [architecture（系统架构）](architecture（系统架构）.md) — 总体架构与部署
- [flows（业务流程）](flows（业务流程）.md) — 用户旅程
- [permissions（权限模型）](permissions（权限模型）.md) — 角色矩阵
- [open-api（开放接口）](open-api（开放接口）.md) / [open-api-integration（开放接口对接指南）](open-api-integration（开放接口对接指南）.md) — 外部对接
- [variables（环境变量）](variables（环境变量）.md) — 配置与密钥清单
- [tests（测试覆盖）](tests（测试覆盖）.md) — 测试矩阵
- [feature-status（功能现状盘点）](../reports/feature-status（功能现状盘点）.md) — 成熟度与遗留问题