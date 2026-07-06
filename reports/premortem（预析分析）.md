# Pre-Mortem: 中试生产管理 AI 聊天平台

**Date:** 2026-07-06
**Status:** Draft
**Scope:** 上线/试运行阶段风险分析

---

## 项目背景

基于 pi-coding-agent 框架的中试生产管理 AI 聊天平台，核心功能：
- 订单进度直连 SQL Server 查询（4 个业务范围）
- 五大基地产能负荷分析
- 智能下单基地推荐
- 交期估算

技术栈：TypeScript Monorepo（pi_agent + Hono SSE server + Next.js web）

---

## Risk Summary

- **Tigers**: 14（5 launch-blocking, 6 fast-follow, 3 track）
- **Paper Tigers**: 3
- **Elephants**: 2

---

## Launch-Blocking Tigers

| # | Risk | Likelihood | Impact | Mitigation | Owner | Deadline |
|---|------|-----------|--------|-----------|-------|----------|
| T1 | **LLM API 不可用导致服务完全中断** — 当前只配置单一模型供应商（deepseek），无 fallback。服务端启动时若 API Key 缺失直接 crash（`getEnvConfig()` throw）。 | High | Critical — 所有用户无法使用 | 1) 启动时优雅降级：API Key 缺失时记录错误但不退出进程，chat API 返回明确提示；2) 配置 secondary provider（如 openai/qwen）；3) 添加 `/health` 中的 LLM 连通性检查 | — | 上线前 |
| T2 | **LLM 幻觉导致用户基于错误信息做决策** — Agent 可能编造订单状态、交期、产能数据。`AGENTS.md` 第 63 行要求"找不到不要编"，但 LLM 不总是遵守。生产决策（交期承诺、基地选择）依赖此信息的后果严重。 | Medium | Critical — 生产事故 | 1) 工具调用结果在 UI 上明确标注"系统数据"（非 LLM 生成）；2) 关键数据（交期、完成状态）强制走 tool 返回，禁止 LLM 凭记忆回答；3) 在 SKILL.md 中增加反幻觉指令：始终引用工具返回的具体数据，不确定时明确说"需要进一步确认" | — | 上线前 |
| T3 | **Docker 镜像中 .env 泄露** — [Dockerfile](Dockerfile) 和 [docker-compose.yml](docker-compose.yml) 存在，若 `.env` 被 COPY 进镜像，SQL 密码和 API Key 将随镜像分发。 | High | Critical — 凭证泄露 | 1) `.dockerignore` 中明确排除 `.env`；2) 敏感配置通过 Docker secrets / K8s secrets / env_file 注入；3) 确认镜像扫描不包含明文密码 | — | 上线前 |
| T4 | **LLM API 费用无预算控制** — 无限流、无用户配额、无费用追踪。DeepSeek API 按 token 计费，恶意或 bug 客户端可产生不可控账单。 | Medium | Critical — 财务风险 | 1) 添加 per-session 和全局 rate limiter；2) LLM provider 端设置 hard budget cap；3) 记录每次调用的 token 消耗（pi-coding-agent 框架可能已有，需确认）；4) 添加 `max_tokens` 限制 | — | 上线前 |
| T5 | **生产数据库直连无只读账号** — [sqlServer.ts](pi_agent/agent/services/sqlServer.ts) 使用 `sa` 账号连接生产库。即使代码只有 SELECT，账号权限过大（可 DROP/TRUNCATE）。Human error 或 SQL 注入变体风险。 | Low | Critical — 数据安全 | 创建专用只读 SQL 账号，仅授予 `db_datareader` 角色，替换 `.env` 中的 `SQL_USER` | DBA | 上线前 |

---

## Fast-Follow Tigers

| # | Risk | Likelihood | Impact | Planned Response | Owner |
|---|------|-----------|--------|-----------------|-------|
| T6 | **SQL Server 连接中断时全量回退 mock 数据** — [tools.ts:90-98](pi_agent/agent/tools.ts#L90-L98) catch 块返回硬编码 mock 数据。用户可能未注意到 "已回退到内存 mock 数据（可能不准确）" 提示，基于错误数据决策。 | Medium | 生产数据不可靠 | 1) Mock 数据标记更强的视觉区分（如红色警告背景）；2) 连续 SQL 失败时触发告警；3) 在 Web UI 顶部显示全局 "实时数据不可用" banner | 前端+后端 |
| T7 | **上海中试数据不完整** — [web/sqlServer.ts:142-148](web/src/lib/sqlServer.ts#L142-L148) 已标注 "JOIN 太慢"，当前只返回基础字段（无异常、无人员）。用户查询上海订单时得到不完整信息。 | High | 用户体验差，可能遗漏关键异常 | 1) 优先添加数据库索引（见 performance audit）；2) 短期：在 UI 上标注"上海中试数据不完整，仅有基础信息"；3) 异常统计另开轻量查询而非 JOIN | 后端 |
| T8 | **SessionStore 内存无限增长** — [sessionStore.ts:26-86](server/src/services/sessionStore.ts#L26-L86) 仅靠 30min TTL 清理。高并发下（50+ 活跃用户），每个 AgentSession 持有 LLM 上下文 + 工具历史，内存消耗大。 | Medium | 服务 OOM → 全部用户掉线 | 1) 添加 maxSessions 上限（如 100），超出时拒绝新会话；2) 添加 LRU 淘汰（最早 inactive 的优先清理）；3) 监控 `sessionStore.size` 并设置告警阈值 | 后端 |
| T9 | **JSONL 会话文件无限增长** — SessionManager 持久化到 `~/.pi/agent/sessions/`。无归档、无大小限制。数月的生产使用可能积累 GB 级 JSONL。 | Medium | 磁盘满 → 服务异常 | 1) 添加定时清理任务（保留最近 N 天 + 活跃会话）；2) 单文件大小限制 + 分片；3) 考虑定期归档到对象存储 | 后端 |
| T10 | **Node.js 单线程被同步 I/O 阻塞** — [executionTracer.ts:148](server/src/services/executionTracer.ts#L148) `fs.appendFileSync` 和 [sessions.ts:139](server/src/routes/sessions.ts#L139) `fs.readFileSync` 在事件循环中同步写/读文件。 | Medium | SSE 流卡顿、超时 | 1) 全部改用 `fs.promises` 异步 API；2) ExecutionTracer 改为写缓冲 + 批量异步写入 | 后端 |
| T11 | **无监控/告警/日志聚合** — 仅有 console.log 输出。无结构化日志持久化、无 metrics、无 tracing。生产问题排查完全依赖 SSH 进服务器看控制台。 | High | 故障发现延迟 → 长时间停机 | 1) 接入简单的日志文件写入（pino/winston）；2) 添加关键 metrics：LLM 延迟 P95、SQL 查询时间、错误率；3) `/health` 端点返回 DB 连接状态 + LLM 连通性 | DevOps |

---

## Track Tigers

| # | Risk | Trigger Condition | Monitoring |
|---|------|-------------------|-----------|
| T12 | **pi-coding-agent 框架 API 变更** — 强依赖内部框架 `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`。框架升级可能破坏 `createAgentSession`、`SessionManager`、`defineTool` 等 API。 | 框架发布新版本时 | 锁定版本号（当前 package.json 中确认）；升级前在 staging 环境跑冒烟测试 |
| T13 | **SQL Server ERP schema 字段名变更** — 硬编码字段如 `f52977`, `f52974`, `f140429` 等（共 ~40 个 magic number 字段）。若 ERP 系统升级/迁移，所有 SQL 模板静默失效（返回空结果）。 | ERP 系统升级通知 | 添加 SQL 查询结果的字段完整性校验；为每个基地维护一份 "预期字段清单" |
| T14 | **多基地查询性能随数据增长退化** — `queryOrderProgressMany` 并行查 4 个基地，每个 SQL 模板含 LEFT JOIN + CROSS JOIN + 子查询。若单表数据从千级增长到十万级，查询时间可能从 100ms → 5s+。 | 各表行数 > 10,000 | 监控 P95 查询延迟；超过 1s 时触发索引优化 |

---

## Paper Tigers

| # | Risk | Why Manageable |
|---|------|---------------|
| P1 | **DeepSeek 模型能力不足** — 担心 deepseek-v4-flash 对中文生产管理术语理解不够，意图路由错误。 | 1) 3 个 SKILL.md 提供了详细的中文行为规范；2) 工具 schema（TypeBox）强制执行参数类型；3) AGENTS.md 的意图路由表覆盖了核心场景。必要时可切换 `AI_MODEL=deepseek-v4-pro`（更强推理）。 |
| P2 | **SSE 连接泄漏** — 担心客户端断连后 SSE stream 未正确清理。 | `chat.ts:110-139` 的 `try/finally` 保证 `unsubscribe()` + `store.setBusy(false)` 在异常路径也执行。Hono 的 `streamSSE` 在客户端断开时自动关闭 stream。 |
| P3 | **用户不会用聊天界面** — 担心用户不知道怎么提问。 | 1) 前端 ChatPanel 可预设 prompt 模板（"查订单进度"、"看产能负荷"）；2) LLM 的 AGENTS.md 指令第 62 行已定义 "信息不足时追问"。可增加 onboarding 引导消息。 |

---

## Elephants in the Room

| # | Issue | Suggested Conversation Starter |
|---|-------|-------------------------------|
| E1 | **数据准确性责任归属** — 当 AI 助手返回错误的生产信息（例如：承诺了不可达的交期、漏报了异常工序），导致业务损失（客户投诉、产线停产），责任由谁承担？是 AI 开发团队、计划岗、还是使用 AI 的业务员？ | "我们需要明确 AI 助手的定位：是'决策支持工具'还是'自动化决策系统'？如果是前者，需要一个免责声明和人工确认环节；如果是后者，需要更严格的数据校验和 SLA。" |
| E2 | **计划岗角色的冲击** — 项目核心价值是"让业务员自助查单，无需人工咨询计划岗"。如果 AI 助手成功，计划岗的日常咨询工作量大幅下降——这可能导致岗位调整或人员优化。计划岗同事可能消极配合甚至抵触。 | "我们应该如何让计划岗同事成为 AI 助手的受益者而非受害者？例如：让他们从'重复回答查单电话'中解放出来，专注于排产优化和异常处理。" |

---

## Go/No-Go Checklist

- [ ] T1: LLM fallback + 启动优雅降级
- [ ] T2: 反幻觉 UI 标注 + SKILL.md 指令加固
- [ ] T3: Docker secrets 管理确认
- [ ] T4: Rate limiter + LLM budget cap
- [ ] T5: SQL 只读账号创建
- [ ] T6-T11: Fast-follow tigers 分配 owner + sprint 排期
- [ ] T12-T14: 监控指标定义 + dashboard 搭建
- [ ] E1: 免责声明 / 使用协议起草
- [ ] E2: 与计划岗团队的沟通计划
- [ ] 回滚方案：如何快速切回 "人工查单" 模式？
- [ ] 支持团队培训：一线 support 如何排查 AI 助手常见问题？

---

## Next Steps

基于以上分析，建议：
1. **优先修复 5 个 launch-blocking tigers**，特别是 T2（幻觉）、T3（凭证泄露）、T4（费用控制）
2. **运行测试场景生成**（`/pm-execution:test-scenarios`）覆盖 T2、T6、T7 的用户场景
3. **安排一次团队讨论** E1 和 E2（可能需要产品负责人 + 部门主管参与）
