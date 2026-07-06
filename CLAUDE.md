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
├── server/src/              # Hono SSE 服务：index.ts, routes/chat.ts, routes/sessions.ts
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
2. **工具白名单** — LLM 只能调用 6 个领域工具（TOOL_NAMES），不可访问 filesystem/shell/network
3. **SQL 参数化** — 所有查询必须用 `@param` 绑定，禁止字符串拼接
4. **ALS 用户上下文** — 工具执行时通过 `runWithUser()` → `requireCurrentUser()` 获取身份，不可绕过
5. **权限矩阵** — 修改 `TOOL_PERMISSIONS` 前查看 `documentation/permissions.md`
6. **环境变量** — `.env` 不入库、不入 Docker 镜像。所有 secrets 清单见 `documentation/variables.md`

## 当前已知问题（修改代码时注意）

- **鉴权未接入**：`ANON_USER.role = "supervisor"` 是临时方案，`body.user` 可被伪造。生产上线前必须替换
- **上海中试 JOIN 慢**：`sqlServer.ts` 的上海 SQL 模板 5 表 JOIN，实际 web 端只用基础查询
- **同步 I/O**：`executionTracer.ts:148` 和 `sessions.ts:139` 用了 `fs.*Sync`
- **`recommend_base` 只用 mock 数据**：与 `analyze_capacity`（有 SQL 路径）不一致

## 常用命令

```bash
npm run dev --workspace=server   # 启动后端 :8000（自动加载 pi_agent/.env）
npm run dev --workspace=web      # 启动前端 :3000
```

## 文档命名规范

新建文档统一使用 **英文名（中文说明）.md** 格式。技术术语不翻译，括号内中文辅助识别。如 `architecture（系统架构）.md`、`security-audit（安全审计）.md`。

文档正文以中文为主，技术术语保留原文（SQL Server、SSE、LLM、Agent 等），代码块、文件路径和命令行保持不变。

## 完整文档

见 `documentation/` 和 `reports/` 目录。
