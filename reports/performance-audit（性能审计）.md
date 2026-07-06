# Performance Audit: production_agent

**Scope:** `d:\AIAgent\production_agent\` — pi_agent/server/web 全栈代码
**Date:** 2026-07-06
**Method:** 静态代码审查（非负载测试）

---

## 1. N+1 Queries & Request Waterfalls

### 1.1 `getRealTimePendingCounts` 3 次顺序查询

- **Finding:** 3 个独立 SQL 查询（广州中试、小试、OA辅助单）串行执行，每个都在独立的 try/catch 中等待完成才发起下一个。
- **Evidence:** [pi_agent/agent/services/sqlServer.ts:358-410](pi_agent/agent/services/sqlServer.ts#L358-L410) — 3 段独立的 `try { await pool.request()... }`，无并行化。
- **Recommendation:** 用 `Promise.allSettled` 并行发起 3 个查询，结果在全部完成后合并。可减少约 60-70% 等待时间。
- **Effort:** Low
- **Priority:** Medium
- **Expected effect:** `analyzeCapacityTool` 响应时间减少 60%+（3 次网络往返合并为 1 次）

### 1.2 `fetchAllDashboardOrders` 4 次顺序查询

- **Finding:** Web 端看板数据加载时，4 个数据源（广州中试、上海中试、小试、OA辅助单）在一个 for-of 循环中逐个查询。
- **Evidence:** [web/src/lib/sqlServer.ts:296-317](web/src/lib/sqlServer.ts#L296-L317) — `for (const { sql, source, needsSince } of queries)` 内 `await req.query(sqlText)`。
- **Recommendation:** 改为 `Promise.allSettled(queries.map(...))`，4 个查询并行发出。
- **Effort:** Low
- **Priority:** High
- **Expected effect:** 看板首页加载时间减少 65-75%（4 次 DB 往返 → 1 次等待）

### 1.3 Dashboard route 多次遍历同一数组

- **Finding:** `/api/dashboard` 路由中对 `orders` 数组执行了多次 `.filter()` + `.map()` + `.sort()` 遍历，包括分组、状态分类、逾期检查、工序分布、Top 5 排序等，部分在嵌套循环中。
- **Evidence:** [web/src/app/api/dashboard/route.ts:136-221](web/src/app/api/dashboard/route.ts#L136-L221) — `for (const o of orders)` 嵌套 `baseOrders.filter(...)` 多次。`allWarnings` 的构建（L237-257）再次遍历全部 orders。
- **Recommendation:** 单次遍历完成所有聚合（计数、异常统计、工序分布），使用 `reduce` 或单次 for-of。逾期订单在遍历中顺便收集，避免二次扫描。
- **Effort:** Medium
- **Priority:** Medium
- **Expected effect:** 看板 API 响应减少 20-30% CPU 时间（orders > 500 时显著）

### 1.4 Session 列表同步读取大文件

- **Finding:** `GET /api/sessions` 列出所有会话，`GET /api/sessions/:id` 用 `fs.readFileSync` 同步读取整个 JSONL 文件到内存。
- **Evidence:** [server/src/routes/sessions.ts:139](server/src/routes/sessions.ts#L139) — `fs.readFileSync(info.path, "utf-8")` 阻塞事件循环。
- **Recommendation:** 改用 `fs.promises.readFile`；对长历史会话增加分页参数（`?limit=50&offset=0`）。
- **Effort:** Low
- **Priority:** Medium
- **Expected effect:** 消除同步 I/O 阻塞；大文件场景下避免 OOM

---

## 2. Over-fetching

### 2.1 Dashboard API 下发全量订单详情

- **Finding:** `/api/dashboard` 返回每个基地的 `recentOrders`（Top 5）数组，但在此之前已经从 SQL Server 拉取了全部订单的全部字段（18+ 字段/订单），然后在服务端丢弃了大部分。
- **Evidence:** [web/src/app/api/dashboard/route.ts:81-111](web/src/app/api/dashboard/route.ts#L81-L111) — `fetchAllDashboardOrders(30)` 拉全量；L185-198 `recentOrders` 只用前 5 条。
- **Recommendation:** SQL 查询直接加 `TOP N`，或在 API 层分两个查询：聚合统计用 `SELECT COUNT` + `GROUP BY`（轻量），详情只在需要时按基地懒加载。
- **Effort:** Medium
- **Priority:** High
- **Expected effect:** SQL Server 传输量减少 80%+；看板首页响应时间减少 50%+

### 2.2 SQL 模板全字段 SELECT

- **Finding:** pi_agent 和 web 两端的 SQL 模板均查询 18-20 个字段，但很多场景只需要其中 3-5 个（如：产能分析只需要 pending/complete 计数，不需要人名、工序时间）。
- **Evidence:**
  - [pi_agent/agent/services/sqlServer.ts:113-150](pi_agent/agent/services/sqlServer.ts#L113-L150) — `SQL_ZHONGSHI_GUANGZHOU` 选 20 个字段
  - [web/src/lib/sqlServer.ts:107-139](web/src/lib/sqlServer.ts#L107-L139) — `SQL_GZ` 选 18 个字段
- **Recommendation:** 为不同用例设计专用查询。产能统计用 `SELECT COUNT(*) ... GROUP BY`；订单详情才用完整字段集。减少不必要的 `CONVERT(varchar, ...)` 开销。
- **Effort:** Medium
- **Priority:** Medium
- **Expected effect:** SQL Server CPU + 网络传输减少 60%+ 用于聚合查询场景

### 2.3 Session 历史读取整个 JSONL

- **Finding:** 获取单个 session 的历史消息时，读取整个 JSONL 文件，即使只需要最近 N 条。
- **Evidence:** [server/src/routes/sessions.ts:139](server/src/routes/sessions.ts#L139) — `fs.readFileSync(info.path, "utf-8")` 无限制。
- **Recommendation:** 流式读取 JSONL 最后 N 行（tail read），或增加 `?limit=N` 参数限制返回的消息数。
- **Effort:** Low
- **Priority:** Low
- **Expected effect:** 长会话（100+ 轮）内存消耗和响应时间显著下降

---

## 3. Missing or Inefficient Indexes

### 3.1 `tabdiytable3393` 缺少关键索引

- **Finding:** `WHERE t.f52977 = @orderNo` 和 `WHERE t.f52994 > @since` 均为全表扫描风险。
- **Evidence:**
  - [pi_agent/agent/services/sqlServer.ts:150](pi_agent/agent/services/sqlServer.ts#L150) — `WHERE t.f52977 = @orderNo`
  - [pi_agent/agent/services/sqlServer.ts:363](pi_agent/agent/services/sqlServer.ts#L363) — `WHERE f52994 > @s`
- **Recommendation:**
  ```sql
  CREATE INDEX idx_3393_order ON tabdiytable3393(f52977);
  CREATE INDEX idx_3393_create_time ON tabdiytable3393(f52994);
  ```
- **Effort:** Low
- **Priority:** High
- **Expected effect:** 订单查询从全表扫描变为索引查找，响应时间可能从秒级降至毫秒级

### 3.2 `tabdiytable3439` 子查询无复合索引

- **Finding:** `ROW_NUMBER() OVER (PARTITION BY f136277, f53444 ORDER BY ID DESC)` + `WHERE f53444 IN (...)` 在所有 SQL 模板中复用（小试、OA辅助单），无复合索引导致每次全表扫描 + 排序。
- **Evidence:**
  - [pi_agent/agent/services/sqlServer.ts:182-191](pi_agent/agent/services/sqlServer.ts#L182-L191)
  - [web/src/lib/sqlServer.ts:196-203](web/src/lib/sqlServer.ts#L196-L203)
- **Recommendation:**
  ```sql
  CREATE INDEX idx_3439_personnel ON tabdiytable3439(f136277, f53444, ID DESC);
  ```
- **Effort:** Low
- **Priority:** High
- **Expected effect:** 小试和 OA 辅助单查询性能提升 10-50x（消除全表扫描 + 排序）

### 3.3 上海中试 JOIN 链缺少索引

- **Finding:** 5 表 JOIN（`tabdiytable5724/5698/5699/5707/5711`）无复合索引标注，当前实现不得不拆分为 "只查基础" + 跳过异常统计的 workaround。
- **Evidence:**
  - [web/src/lib/sqlServer.ts:142-161](web/src/lib/sqlServer.ts#L142-L161) — `SQL_SH_BASE` 注释："上海中试 JOIN 太慢，待 SQL 优化"
  - [pi_agent/agent/services/sqlServer.ts:216-220](pi_agent/agent/services/sqlServer.ts#L216-L220) — 同样的 5 表 JOIN
- **Recommendation:**
  ```sql
  CREATE INDEX idx_5724_order ON tabdiytable5724(f96425, f96426);
  CREATE INDEX idx_5698_order ON tabdiytable5698(f95892, f95902);
  CREATE INDEX idx_5699_order ON tabdiytable5699(f95904, f95916);
  CREATE INDEX idx_5707_order ON tabdiytable5707(f96198, f96214);
  CREATE INDEX idx_5711_order ON tabdiytable5711(f96280);
  ```
- **Effort:** Low
- **Priority:** High
- **Expected effect:** 上海中试从"无法加载异常数据"恢复到完整功能

### 3.4 `tabdiytable8460` OA 辅助单日期过滤无索引

- **Finding:** `WHERE t.f138823 > @since` 在 OA 辅助单的产能统计查询中可能出现全表扫描。
- **Evidence:** [pi_agent/agent/services/sqlServer.ts:399](pi_agent/agent/services/sqlServer.ts#L399)
- **Recommendation:**
  ```sql
  CREATE INDEX idx_8460_scheduling ON tabdiytable8460(f138823);
  ```
- **Effort:** Low
- **Priority:** Medium
- **Expected effect:** OA 辅助单产能统计查询加速

---

## 4. Caching Opportunities

### 4.1 Dashboard 数据无缓存

- **Finding:** `/api/dashboard` 每次页面加载都从 SQL Server 重新拉取全量数据。看板数据（生产状态、工序分布）属于慢变化数据，不需要实时刷新。
- **Evidence:** [web/src/app/api/dashboard/route.ts:76-111](web/src/app/api/dashboard/route.ts#L76-L111) — 无任何缓存层，每次 GET 直接查库。
- **Recommendation:** Next.js 端增加内存缓存（`Map<string, {data, ts}>`），TTL=2min。失效策略：定时过期 + 手动 refresh API。或使用 `stale-while-revalidate` 模式（返回缓存，后台刷新）。
- **Effort:** Medium
- **Priority:** Medium
- **Expected effect:** 看板首页响应从 ~2-5s（含 DB 查询）降至 <50ms（缓存命中）

### 4.2 产能快照无缓存

- **Finding:** `getRealTimePendingCounts()` 每次工具调用都查询 SQL Server。同一轮对话中如果用户同时问产能和交期，会重复查询。
- **Evidence:** [pi_agent/agent/tools.ts:166-177](pi_agent/agent/tools.ts#L166-L177) — `analyzeCapacityTool` 每次 execute 都调 `getRealTimePendingCounts(90)`。
- **Recommendation:** 在 `getRealTimePendingCounts` 内部增加内存缓存（TTL=60s），同一轮对话中复用。失效策略：基于时间的简单过期。
- **Effort:** Low
- **Priority:** Low
- **Expected effect:** 减少同轮对话中的重复 SQL 查询

### 4.3 Skill 文件重复加载

- **Finding:** 每个 session 创建时都通过 `DefaultResourceLoader.reload()` 从磁盘读取 SKILL.md 文件。
- **Evidence:** [pi_agent/agent/session.ts:72-73](pi_agent/agent/session.ts#L72-L73) — `await loader.reload()`。
- **Recommendation:** 在 `getDefaultSkills()` 或 loader 层加内存缓存，仅首次加载读磁盘。
- **Effort:** Low
- **Priority:** Low
- **Expected effect:** Session 创建时间减少 ~10-50ms

---

## 5. Other Findings

### 5.1 `ExecutionTracer` 同步 I/O 阻塞事件循环

- **Finding:** `fs.appendFileSync` 在每次 trace 结束时同步写盘，直接阻塞 Node.js 事件循环。
- **Evidence:** [server/src/services/executionTracer.ts:148](server/src/services/executionTracer.ts#L148) — `fs.appendFileSync(file, JSON.stringify(t) + "\n", "utf-8")`。
- **Recommendation:** 改用 `fs.promises.appendFile`，或使用写缓冲（积攒 N 条 trace 后批量写入）。
- **Effort:** Low
- **Priority:** Medium
- **Expected effect:** 消除 trace 写入对 SSE 流式响应的微阻塞（高并发下明显）

### 5.2 无请求频率限制

- **Finding:** Chat API 和 Sessions API 均无限流保护，恶意或错误客户端可无限调用。
- **Evidence:** [server/src/routes/chat.ts:70](server/src/routes/chat.ts#L70) — 无 rate-limit middleware。
- **Recommendation:** 添加简单的 in-memory rate limiter（如每个 sessionId 每分钟最多 10 次 chat 请求）。
- **Effort:** Low
- **Priority:** Medium
- **Expected effect:** 防止 LLM API 费用失控 + SQL Server 连接池耗尽

### 5.3 `recommendBaseTool` 未使用实时数据

- **Finding:** `analyzeCapacityTool` 尝试从 SQL Server 获取实时待处理数，但 `recommendBaseTool` 始终只用 mock 数据。两个工具对同一基地给出不一致的负荷数据。
- **Evidence:**
  - [pi_agent/agent/tools.ts:164-177](pi_agent/agent/tools.ts#L164-L177) — `analyzeCapacityTool` 有实时 SQL 逻辑
  - [pi_agent/agent/tools.ts:228-237](pi_agent/agent/tools.ts#L228-L237) — `recommendBaseTool` 仅用 `getPendingOrdersByBase`（mock）
- **Recommendation:** 将实时数据获取逻辑抽取为共享函数，两个工具共用。
- **Effort:** Low
- **Priority:** Low
- **Expected effect:** 数据一致性，用户不会看到矛盾信息

### 5.4 Connection Pool 无健康检查

- **Finding:** pi_agent 和 web 两端各有自己的 SQL 连接池，但都没有健康检查或自动重连逻辑。池错误后 `_pool = null`，下次调用重新连接——但在高并发下可能导致连接风暴。
- **Evidence:**
  - [pi_agent/agent/services/sqlServer.ts:79-81](pi_agent/agent/services/sqlServer.ts#L79-L81) — `pool.on("error", () => { _pool = null })`
  - [web/src/lib/sqlServer.ts:39](web/src/lib/sqlServer.ts#L39) — 同样的模式
- **Recommendation:** 增加指数退避重连 + 健康检查端点 `/health` 中检测 `pool.connected`。
- **Effort:** Medium
- **Priority:** Low
- **Expected effect:** 提升生产环境连接稳定性

---

## 6. Already Efficient

以下方面已经做得很好，无需优化：

- **`queryOrderProgressMany` 使用 `Promise.all` 并行查询** — [pi_agent/agent/services/sqlServer.ts:313-323](pi_agent/agent/services/sqlServer.ts#L313-L323)
- **SQL 参数化查询防注入** — 所有 SQL 模板均使用 `@orderNo` / `@since` 参数
- **连接池懒加载 + 单例模式** — 避免重复创建连接
- **SSE 流式响应** — 事件即时推送，无缓冲延迟
- **Session 内存管理 + 30min 过期清理** — [server/src/services/sessionStore.ts:74-81](server/src/services/sessionStore.ts#L74-L81)
- **错误降级策略** — SQL 失败时回退到 mock 数据，避免服务完全不可用
- **异常/错误隔离** — 每个基地的查询失败不影响其他基地
- **Prisma ORM 在前端本地的 SQLite** — 适合看板数据的本地缓存

---

## 7. Needs Runtime Profiling

以下发现需要实际运行负载来确认影响量级：

- **SQL Server 实际数据量** — 各表的行数决定索引建议的紧迫程度。建议在生产库执行 `sp_spaceused` 确认 `tabdiytable3393/5992/5724/8460/3439` 的数据规模。
- **Dashboard API 实际响应时间** — 需要测量 `GET /api/dashboard` 的 P50/P95/P99 延迟，确认缓存是否必要。
- **SSE 事件积压** — 高并发下 `stream.writeSSE` 是否存在背压问题。
- **LLM API 延迟占比** — 确认 Agent 工具调用中，LLM 推理 vs SQL 查询哪部分是瓶颈。

---

## Summary

| Priority | Count | Key Actions |
|----------|-------|-------------|
| **High** | 5 | 并行化看板查询、SQL 索引（3393/3439/5724）、Dashboard 避免全量拉取 |
| **Medium** | 7 | 并行化产能统计、Dashboard 缓存、同步 I/O 改异步、限流、单次遍历优化 |
| **Low** | 5 | Skill 缓存、产能快照缓存、统一实时数据获取、连接池健康检查 |

**建议优先级：先加索引 → 再并行化查询 → 再加缓存。** 索引改动影响最大且风险最低（纯 DDL，不改业务逻辑）。
