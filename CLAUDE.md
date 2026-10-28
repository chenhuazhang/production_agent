# CLAUDE.md — 中试 AI 助手

## 这是什么系统

中试生产管理 AI 聊天平台。基于 pi-coding-agent 框架，TypeScript Monorepo（pi_agent + Hono server + Next.js web）。
业务员输入订单号 → LLM 调度工具查 SQL Server → SSE 流式返回格式化结果。

## 项目结构

```
production_agent/
├── pi_agent/agent/          # Agent 核心：tools.ts, config.ts, session.ts, types.ts
│   ├── services/            # sqlServer.ts, userContext.ts, permissionGuard.ts
│   ├── skills/              # 3 个 SKILL.md（order-progress/capacity-analysis/output-format）
│   └── data/                # mockData.ts, capacity.ts
├── server/src/              # Hono SSE 服务：index.ts, routes/chat.ts, routes/sessions.ts, routes/open_api.ts（对外查进度 API）
│   └── services/            # sessionStore.ts, executionTracer.ts, logger.ts
├── web/src/                 # Next.js 前端
│   ├── app/                 # 页面路由 (dashboard, chat, bases, capacity) + API routes
│   ├── components/          # chat/, dashboard/, capacity/, layout/, ui/
│   └── lib/                 # ai-client.ts, sqlServer.ts, sessions.ts, prisma.ts
├── documentation/           # 系统文档
│   ├── architecture（系统架构）.md
│   ├── flows（业务流程）.md
│   ├── permissions（权限模型）.md
│   ├── variables（环境变量）.md
│   ├── automation（Agent自动化）.md
│   ├── open-api（开放接口）.md
│   ├── open-api-integration（开放接口对接指南）.md
│   └── tests（测试覆盖）.md
├── reports/                 # 分析报告
│   ├── PRD（产品需求文档）.md
│   ├── performance-audit（性能审计）.md
│   ├── security-audit（安全审计）.md
│   ├── premortem（预析分析）.md
│   └── shipping-packet（上线检查包）.md
├── deploy/                  # 部署配置
│   ├── .env                 # 生产环境密钥（不入库）
│   ├── .env.production      # 环境变量模板
│   └── nginx.conf           # Nginx 反代配置
├── tests/                   # E2E 测试脚本
└── docs/research/           # 方案论证 + 调研
```

## 关键边界（绝对不要违反）

1. **只读系统** — 任何情况下不可修改生产数据。`permissionGuard.ts` 硬编码禁止 write/delete/update 前缀的工具
2. **工具白名单** — LLM 只能调用 7 个领域工具（TOOL_NAMES），不可访问 filesystem/shell/network
3. **SQL 参数化** — 所有查询必须用 `@param` 绑定，禁止字符串拼接
4. **ALS 用户上下文** — 工具执行时通过 `runWithUser()` → `requireCurrentUser()` 获取身份，不可绕过
5. **权限矩阵** — 修改 `TOOL_PERMISSIONS` 前查看 `documentation/permissions.md`
6. **环境变量** — `.env` 不入库、不入 Docker 镜像。所有 secrets 清单见 `documentation/variables.md`

## 编码规范

新代码遵循 `CODING_STANDARDS.md`。业务规则见 `Doc/production-agent/cn/01-需求规格.md`，单次改动的验收标准写入 `docs/specs/`。

## 当前已知问题（修改代码时注意）

- **鉴权未接入**：`ANON_USER.role = "supervisor"` 是临时方案，`body.user` 可被伪造。生产上线前必须替换
- **上海中试 JOIN 慢**：`sqlServer.ts` 的上海 SQL 模板 5 表 JOIN，实际 web 端只用基础查询
- ~~**同步 I/O**~~：已修复（2026-10-22）——`executionTracer` 与 `SessionRepository` 均改为 `fs/promises`
- **`recommend_base` 只用 mock 数据**：与 `analyze_capacity`（有 SQL 路径）不一致

## 常用命令

```bash
npm run dev --workspace=server   # 启动后端 :8001（自动加载 pi_agent/.env）
npm run dev --workspace=web      # 启动前端 :3001
```

> 端口说明：本地 dev 用 **8001 / 3001**，避开 Docker 堆栈占用的 8000 / 80，避免 `localhost` 解析到 Docker 容器造成会话库分裂。
> MaxKB 的模型 API 域名用 `http://<agent内网IP>:8001/v1`，与本地 server 端口保持一致。
>
> MaxKB 多智能体分流：企业微信机器人 A/B 各自绑定一个 MaxKB 应用，应用的模型名分别填 `production-agent-gz`（仅广州送样&小订单）和 `production-agent-main`（广州工艺实验/小试/上海工艺实验/OA辅助单）；`production-agent` 为全部业务（默认）。两个应用共用一把 `SYNC_API_KEY`，服务端按请求里的模型名路由业务范围。

## 文档命名规范

新建文档统一使用 **英文名（中文说明）.md** 格式。技术术语不翻译，括号内中文辅助识别。如 `architecture（系统架构）.md`、`security-audit（安全审计）.md`。

文档正文以中文为主，技术术语保留原文（SQL Server、SSE、LLM、Agent 等），代码块、文件路径和命令行保持不变。

## 完整文档

见 `documentation/` 和 `reports/` 目录。
