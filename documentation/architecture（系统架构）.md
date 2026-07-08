# 系统架构：中试 AI 助手

## 系统概述

中试 AI 助手是一个基于 LLM Agent 的生产管理聊天平台，让业务员通过自然语言自助查询订单进度、产能负荷、下单推荐和交期估算。

**一句话**：输入订单号 → LLM 调度工具查询 SQL Server → SSE 流式返回格式化结果。

## 技术栈

| 层级 | 技术 | 作用 |
|-------|-----------|------|
| Agent 框架 | `@earendil-works/pi-coding-agent` | LLM 调度、工具定义、会话管理、上下文压缩 |
| AI 模型 | `@earendil-works/pi-ai` + `~/pi/agent/models.json` | 多供应商模型抽象（内置: DeepSeek / OpenAI / Qwen / Anthropic / Google；自定义: Bailian 百炼 → GLM-5.2） |
| 后端服务 | Hono (Node.js) | HTTP + SSE 路由、Session 生命周期管理 |
| 前端 | Next.js (App Router) | 聊天界面、生产看板、SSE 消费 |
| 业务数据库 | SQL Server (mssql) | 中试生产管理 ERP 数据库，4 个业务范围 |
| 本地数据库 | SQLite (Prisma) | 前端本地看板数据缓存、基地/订单 seed 数据 |
| 会话存储 | JSONL 文件 (`~/.pi/agent/sessions/`) | 对话持久化、历史回溯、分支/fork |

## 组件架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    用户浏览器 (:3000)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ 对话面板     │  │  生产看板    │  │ 产能 / 基地管理    │  │
│  │ (SSE 流)    │  │  (REST JSON) │  │ (REST JSON)        │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬───────────┘  │
└─────────┼────────────────┼───────────────────┼──────────────┘
          │ SSE            │ REST              │ REST
          ▼                ▼                   ▼
┌──────────────────────────────────────────────────────────────┐
│                  Hono 服务 (:8000)                             │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │ POST /api/chat/  │  │ GET/POST/DELETE /api/sessions     │  │
│  │   :sessionId     │  │ GET /health                      │  │
│  └────────┬─────────┘  └──────────────────────────────────┘  │
│           │                                                    │
│  ┌────────▼──────────────────────────────────────────────┐   │
│  │              SessionStore (内存)                        │   │
│  │  - getOrCreate(sessionId) → AgentSession               │   │
│  │  - busy 标记（防并发）                                  │   │
│  │  - 30 分钟过期自动清理                                   │   │
│  └────────┬──────────────────────────────────────────────┘   │
│           │                                                    │
│  ┌────────▼──────────────────────────────────────────────┐   │
│  │         ExecutionTracer (JSONL 日志)                    │   │
│  │  - 每次请求一条 trace（文本 + 工具调用 + 耗时）         │   │
│  │  - 持久化到 data/logs/traces/{日期}.jsonl              │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────┘
                           │ createSession()
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              pi_agent（Agent 核心）                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  createAgentSession({                                   │  │
│  │    model, authStorage, sessionManager, resourceLoader,  │  │
│  │    customTools: [6 个工具], tools: TOOL_NAMES（白名单）  │  │
│  │  })                                                     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ 3 Skills │  │  6 Tools     │  │  PermissionGuard      │  │
│  │ (SKILL.  │  │  (defineTool │  │  (角色 × 基地矩阵)     │  │
│  │  md)     │  │  + TypeBox)  │  │  + DENY_ALWAYS 写拦截 │  │
│  └──────────┘  └──────┬───────┘  └───────────────────────┘  │
│                       │                                       │
│            ┌──────────▼──────────┐                           │
│            │   SQL Server        │                           │
│            │   (mssql 连接池)    │                           │
│            │   4 套 SQL 模板     │                           │
│            │   参数化查询        │                           │
│            └─────────────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

## 部署架构

### 容器拓扑

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Host (Windows / Linux)         │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Bridge Network: agent-net            │  │
│  │                                                  │  │
│  │  ┌──────────────────┐  ┌────────────────────┐   │  │
│  │  │ agent            │  │ web                 │   │  │
│  │  │ (Dockerfile      │  │ (Dockerfile.web)    │   │  │
│  │  │  .server)        │  │                     │   │  │
│  │  │                  │  │ 内部: :3000          │   │  │
│  │  │ 内部: :8000      │  │ 映射: :80 → :3000   │   │  │
│  │  │ 映射: :8000:8000 │  │ 用户入口 ←─          │   │  │
│  │  │                  │  │                     │   │  │
│  │  │ Hono + pi-agent  │  │ Next.js + Prisma    │   │  │
│  │  │ + SQL Server     │  │ + SQLite            │   │  │
│  │  │ 客户端 (mssql)   │  │                     │   │  │
│  │  │                  │  │ AI_API_URL →        │   │  │
│  │  │ LLM API ───────────── http://agent:8000   │   │  │
│  │  └────────┬─────────┘  └────────────────────┘   │  │
│  │           │                                      │  │
│  └───────────┼──────────────────────────────────────┘  │
│              │                                         │
│  ┌───────────▼──────────┐  ┌──────────────────────┐   │
│  │ Docker Volumes       │  │ 外部依赖              │   │
│  │ agent-sessions       │  │                      │   │
│  │  → /root/.pi         │  │ SQL Server (内网)    │   │
│  │ agent-traces         │  │ 172.18.28.88:1433    │   │
│  │  → /app/data/logs    │  │                      │   │
│  └──────────────────────┘  │ LLM API (外网)       │   │
│                            │ Bailian / DeepSeek   │   │
└────────────────────────────┴──────────────────────┘   │
```

### 容器说明

| 容器 | 基础镜像 | 镜像来源 | 端口映射 | 职责 |
|------|---------|---------|---------|------|
| `agent` | `node:22-alpine` (Alpine/musl) | `Dockerfile.server` 本地构建 | `8000:8000` | Hono SSE 服务 + pi_agent 核心 + SQL Server 客户端 |
| `web` | `node:22-slim` (Debian/glibc) | `Dockerfile.web` 本地构建 | `80:3000`（用户入口） | Next.js 前端 + Prisma SQLite（看板降级数据库） |

> **基础镜像选型**：agent 用 Alpine（纯 JS，无 native 依赖）；web 用 Debian Slim（Tailwind v4 的 lightningcss 等需要 glibc 预编译二进制，Alpine/musl 不兼容）。

### 网络

两个容器通过 Docker bridge 网络 `agent-net` 内部通信：

```
浏览器 ──HTTP:80──▶ web (:3000)  ──HTTP──▶  agent:8000    （/api/chat、/api/sessions）
                          │                           
                          └── Next.js rewrites 代理：
                              仅 /api/chat/* 和 /api/sessions/* 转发给 agent
                              /api/dashboard、/api/bases 等由 Next.js 自己处理
                          
agent ──TCP──▶  SQL Server (172.18.28.88:1433，内网)
agent ──HTTPS──▶ LLM API (Bailian 百炼 / 阿里云)
```

### 持久化

| 数据 | 存储位置 | 生命周期 | 说明 |
|------|---------|---------|------|
| 会话对话记录 | Docker Volume `agent-sessions` → 容器内 `/root/.pi` | 永久 | JSONL 格式，每轮对话一个文件 |
| 执行日志 (traces) | Docker Volume `agent-traces` → 容器内 `/app/data/logs/traces` | 永久，建议定期清理 | 每次工具调用+耗时 |
| LLM 配置 | `deploy/models.json` → `docker cp` 进容器 `/root/.pi/agent/models.json` | 容器重建后需重新 `docker cp` | 自定义 provider（百炼 bailian + GLM 模型） |
| 配置/密钥 | `deploy/.env` | 宿主机文件 | 不入库、不入镜像 |
| 看板降级数据库 | 容器内 `/app/web/prisma/dev.db` (SQLite) | 容器重建清空 | SQL Server 不通时自动降级到 seed 数据 |

### 部署文件

| 文件 | 用途 | Git |
|------|------|:--:|
| `docker-compose.yml` | 编排 agent + web + nginx | ✅ |
| `docker-compose.simple.yml` | 简化版：agent + web（无 nginx，内网推荐） | ✅ |
| `Dockerfile.server` | agent 容器构建（node:22-alpine + tsx 运行时） | ✅ |
| `Dockerfile.web` | web 容器构建（node:22-slim + Next.js + Prisma） | ✅ |
| `.dockerignore` | 排除 node_modules/.git/文档/测试，保留 pi_agent/.env | ✅ |
| `deploy/.env` | 生产环境变量（AI key / SQL 密码等） | ❌ `.gitignore` |
| `deploy/.env.production` | 环境变量模板（占位值） | ✅ |
| `deploy/models.json` | 百炼 bailian provider + GLM-5.2 模型定义 | ✅ |
| `deploy/nginx.conf` | Nginx 反代 + SSL 配置模板 | ✅ |

### 健康检查

两个容器都用 Node.js 实现（不依赖 wget/curl）：

```yaml
# agent
test: ["CMD", "node", "-e", "require('http').get('http://localhost:8000/health',r=>{process.exit(r.statusCode===200?0:1)})"]

# web
test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000',r=>{process.exit(r.statusCode===200?0:1)})"]
```

### 启动命令

```bash
# 生产环境（简化版，内网推荐）
docker compose -f docker-compose.simple.yml up -d --build

# 生产环境（完整版，含 nginx 反代 + 未来 SSL）
docker compose up -d --build

# 只重建某个服务
docker compose up -d --build web       # 前端改了
docker compose up -d --build agent     # 后端改了

# 配置变更（不用 --build，但必须 force-recreate）
docker compose up -d --force-recreate agent

# 从 GitHub 部署（服务器上）
git pull origin main
docker compose up -d --build web       # 或 agent
```

### 首次部署额外步骤

```bash
# 1. 创建 deploy/.env（从模板填入真实密钥）
cp deploy/.env.production deploy/.env

# 2. 拷入 LLM 配置
docker cp deploy/models.json 容器名:/root/.pi/agent/models.json
```

## 信任边界

```
不可信                      可信（服务端）               外部
──────                      ────────────               ────
用户输入 ────────────────────► LLM API ◄────── DeepSeek / OpenAI
(浏览器)       SSE/HTTP       (Agent)         API Key
                              │
                    ┌─────────▼────────┐
                    │  工具执行         │──────► SQL Server
                    │  (Permission     │   只读账号
                    │   Guard)         │   凭据
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  响应            │──────► 浏览器
                    │  (SSE 流)       │   JSON/文本
                    └─────────────────┘
```

**关键信任假设**（当前状态）：
1. **用户身份** — 来自请求体 `body.user`，未经签名验证（⚠️ 试运行前需替换为 token 验证）
2. **默认用户** — 未传 user 时使用 `ANON_USER` (role=supervisor)（⚠️ 试运行前需降级为最低权限）
3. **SQL Server** — ✅ 只读账号 `comm_plm_prd`，encrypt=false，内网直连
4. **LLM 输出** — LLM 文本输出不可信（可能幻觉），关键数据强制通过 tool 返回
5. **LLM 配置** — 通过 `deploy/models.json` 自定义 provider（Bailian 百炼），不入 pi-ai 框架内置列表
6. **Docker 网络** — web 容器通过 Next.js rewrites 代理 /api/chat 和 /api/sessions 至 agent，浏览器不直连 agent

## 数据流：生产看板

```
用户: 打开 /dashboard 页面
  │
  ▼
Next.js GET /api/dashboard
  │ 服务端 fetchAllDashboardOrders(30)
  ├── 尝试 SQL Server（4 个基地并行）
  │   └── 通达 → 返回真实生产数据
  │   └── 不通 → catch
  │       └── Prisma SQLite（降级 seed 数据）
  ▼
计算: 按基地分组 → KPI 汇总 → 逾期/预警 → Top 5
  │
  ▼
JSON → React 组件 (DashboardKpiCards / BaseOrderCard / DeliveryWarnings)
```

## 数据流：订单查询

```
用户: "查 ZS-2026-001 进度"
  │
  ▼
Hono POST /api/chat/:sessionId
  │ body.text → AgentSession.prompt(text)
  ▼
LLM 决策: 调用 query_order_progress({order_no: "ZS-2026-001"})
  │
  ▼
Agent 执行 queryOrderProgressTool
  │ checkPermission("query_order_progress", params)  ← ALS 用户上下文
  │ queryOrderProgress(orderNo) → Promise.all(4 个基地)
  ▼
SQL Server → recordset → {base, rows, found}
  │
  ▼
工具结果 → LLM 格式化回复 → SSE 流 → 浏览器
  text_delta: "订单 ZS-2026-001 在广州中试..."
  tool_start / tool_end: query_order_progress
  done: {}
```

## 并发模型

- Hono server: 单 Node.js 进程，异步 I/O
- SessionStore: 内存 Map，per-session busy flag 阻止同会话并发
- SQL 连接池: 最大 10 连接（server），最大 5（web）
- Agent: 单轮 prompt()，同会话内无多轮并发

## 关联文档

- [flows（业务流程）](flows（业务流程）.md) — 权限相关用户旅程
- [permissions（权限模型）](permissions（权限模型）.md) — 角色矩阵与访问控制
- [variables（环境变量）](variables（环境变量）.md) — 配置与密钥清单
- [automation（Agent 自动化）](automation（Agent自动化）.md) — Agent 工具面与护栏
- [tests（测试覆盖）](tests（测试覆盖）.md) — 测试覆盖矩阵与 CI 建议
- [docker-lessons（Docker部署经验总结）](../reports/docker-lessons（Docker部署经验总结）.md) — 部署踩坑全记录
- [PRD（产品需求文档）](../reports/PRD（产品需求文档）.md) — 产品需求文档
- [shipping-packet（上线检查包）](../reports/shipping-packet（上线检查包）.md) — 安全+性能+测试综合审查
