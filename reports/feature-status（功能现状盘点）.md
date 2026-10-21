# 功能现状盘点（Feature Status）

> 本文档盘点**当前代码库中已实现、部分实现、尚未实现**的功能，标清每个功能的**数据来源真实度**，并与 PRD、AGENTS.md（系统提示）中的描述对齐，指出其中的差异与遗留问题。
>
> 定位：面向接手项目的工程师 / 产品，用于快速判断「哪些能用、哪些是演示数据、哪些还差什么」。
> 详细设计见 [detailed-design（功能详细设计）](../documentation/detailed-design（功能详细设计）.md)。

## 成熟度分级约定

| 标记 | 含义 |
|------|------|
| ✅ 已实现·真实数据 | 功能可用，数据来自 SQL Server（生产 ERP） |
| 🟡 已实现·演示数据 | 功能代码可用，数据来自 mock / 静态常量 / seed，不代表真实生产 |
| 🟠 部分实现 | 已有代码路径但覆盖不全或依赖外部未接入项 |
| ⏳ 未实现 | 仅占位 / 声明「待发布」，无可用实现 |

---

## 一、功能清单与成熟度矩阵

### 1. Agent 工具层（`pi_agent/agent/tools.ts`，共 7 个工具）

| 工具 | 成熟度 | 数据来源 | 说明 |
|------|:---:|------|------|
| `query_order_progress` | ✅ 真实数据 | SQL Server（点查，5 类并行） | 核心功能。未命中主表时降级查「未排产登记表」，查无再降级 mock |
| `query_orders_list` | ✅ 真实数据 | SQL Server（列表，多维过滤 + 三路统计） | 技术员/牌号/产品线/业务类型/基地/排产时间组合查询；SQL 失败**无 mock 降级**（直接报错） |
| `analyze_capacity` | 🟠 部分实现 | SQL Server 实时待处理数 + **mock 设备产能配置** | 待处理单数走 SQL（`getRealTimePendingCounts`），但「设备台数 / 单台日产量」仍取自 `mockData.ts` 的 `BASE_CONFIGS` |
| `search_orders` | 🟡 演示数据 | `mockData.ts` | 关键词搜索完全走 mock，未接 SQL |
| `get_production_stages` | 🟡 演示数据 | 静态常量 `PRODUCTION_STAGES` | 返回标准工序列表，是业务定义不是查询 |
| `recommend_base` | 🟡 演示数据 | `mockData.ts` + `capacity.ts` | 完全 mock，未走 SQL（CLAUDE.md 已知问题） |
| `estimate_delivery` | 🟡 演示数据 | `mockData.ts` + `capacity.ts` | 完全 mock，未走 SQL |

### 2. 核心链路与平台能力

| 能力 | 成熟度 | 说明 |
|------|:---:|------|
| SSE 流式聊天（/api/chat） | ✅ | text_delta / thinking_delta / tool_start / tool_end / done / error |
| 思考链透传（reasoning tokens） | ✅ | `thinking_delta` 转发到前端，可折叠灰色展示 |
| 会话持久化与历史回溯 | ✅ | JSONL 文件（框架自带 `SessionManager`），含自动压缩 Compaction |
| 会话管理（列表/详情/重命名/删除/置顶） | ✅ | /api/sessions/*，置顶存 `data/session-meta.json` |
| 业务范围分流（多智能体） | ✅ | 按模型名 `production-agent-gz` / `production-agent-main` 钳制业务类型 |
| OpenAI 兼容接口（MaxKB 接入） | ✅ | `/v1/models`、`/v1/chat/completions`（同步 + 流式） |
| 对外开放接口（/open） | ✅ | `/open/orders/progress`、`/open/orders/list`，fail-closed 鉴权 |
| 模型额度降级链 | ✅ | 主模型额度用尽自动切换 `AI_MODEL_FALLBACKS` 下一个 |
| 执行链路日志（tracer） | ✅ | 每次请求一条 trace 落盘 `data/logs/traces/{日期}.jsonl` |
| 回复反馈页脚 | ✅ | 传输层附加，不写会话历史 |

### 3. Web 前端（`web/src`）

| 页面 / 接口 | 成熟度 | 说明 |
|------|:---:|------|
| 聊天页 `/chat` | ✅ | SSE 消费 + 工具调用卡片展示（ToolResultCard） |
| 生产看板 `/dashboard` | ✅ 真实数据 | `web/src/lib/sqlServer.ts` 直连 SQL（5 数据源），失败降级 PostgreSQL seed |
| 产能页 `/capacity` | 🟠 部分实现 | `/api/capacity` 走 **Prisma（PostgreSQL）的 base+snapshot**，**不是** Agent 的 SQL 实时数；查不到再回退硬编码 mock |
| 基地管理 `/bases` | 🟡 演示数据 | `/api/bases` 走 Prisma 的 base 表（seed 数据），仅列表 + 新增 |
| 看板本地库 | ✅ PostgreSQL | Prisma provider 已从 SQLite 切到 PostgreSQL（见 git 最新提交） |

---

## 二、与 PRD / AGENTS.md 的关键差异

> 这些差异是接手时最容易被误导的地方，逐条标注。

1. **AGENTS.md 声称「产能分析 / 下单推荐 / 交期估算 = 待发布」，但代码已实现这三个工具。**
   - 真实状态：`analyze_capacity` 有 SQL 待处理数路径；`recommend_base`、`estimate_delivery` 仍是 **纯 mock**。
   - 影响：模型（按 AGENTS.md 系统提示）会向用户标注这三项「待发布」，与实际代码能力脱节。若要让用户用起来，需同步改 AGENTS.md 措辞，并先解决 mock 数据问题。

2. **工具数量：7 个，不是旧架构文档里的 6 个。** `query_orders_list`（多维列表）是后补的，旧架构文档未纳入。

3. **看板数据库已从 SQLite 切到 PostgreSQL**（`web/prisma/schema.prisma` provider=postgresql），架构文档仍写 SQLite，属过期。

4. **「广州中试 / 上海中试」旧数据源名**已按订单号是否含 EX 拆分为「广州工艺实验 / 广州送样&小订单」与「上海工艺实验」，代码里保留旧名兼容 seed/历史数据；「中试上海（非 EX 的上海订单）」临时下线。

---

## 三、遗留问题与待办（来自 CLAUDE.md 与代码审计）

| 优先级 | 问题 | 位置 | 影响 |
|:---:|------|------|------|
| 🔴 高 | **鉴权未接入**：`ANON_USER.role="supervisor"` 临时方案，`body.user` 可伪造 | `server/src/routes/chat.ts` | 任何未鉴权请求都能以 supervisor 身份查全量数据，生产上线前必须替换 |
| 🔴 高 | **SQL 注入面收敛但口令为只读**：确保 SQL 账号仍只读，见边界 1 | `permissionGuard.ts` DENY_ALWAYS | 写操作硬拦截 |
| 🟡 中 | 上海中试（`tabdiytable5724`）5 表 JOIN 慢，产能统计未纳入上海 | `sqlServer.ts` `getRealTimePendingCounts` | 产能/看板上海数据缺失或慢 |
| 🟡 中 | 同步 I/O：`executionTracer.ts` 与 `sessions.ts` 用 `fs.*Sync` / `appendFileSync` | tracer、sessions 落盘 | 高并发下可能阻塞事件循环 |
| 🟡 中 | `recommend_base` / `estimate_delivery` 仅 mock | `tools.ts` | 产能分析与交期估算的推荐结果不代表真实负荷 |
| 🟢 低 | `search_orders` 仅 mock | `tools.ts` | 关键词搜索无真实数据 |
| 🟢 低 | web 产能页数据源与 Agent 不一致（Prisma snapshot vs Agent SQL） | `/api/capacity`、`analyze_capacity` | 两处产能口径可能不一致 |

---

## 四、结论与建议

当前系统**核心价值闭环已打通**：订单号/多维度 → Agent 工具 → SQL Server → SSE → 格式化结果，会话持久化、多智能体分流、开放接口、模型降级等平台能力也齐备。主要短板集中在：

1. **鉴权**（安全红线，上线前必须做）；
2. **产能/推荐/交期三项的 mock 化与口径不一致**（功能已「有架子」但数据不真，且 AGENTS.md 表述与实际不符）；
3. **看板数据库迁移后的文档与 seed 同步**（SQLite → PostgreSQL）。

建议按 🔴 优先处理鉴权，再统一产能三件套的数据源（接 SQL 与 web 口径对齐），最后清理 mock 残留与过期文档。