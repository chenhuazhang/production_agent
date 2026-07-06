# 系统架构：中试 AI 助手

## 系统概述

中试 AI 助手是一个基于 LLM Agent 的生产管理聊天平台，让业务员通过自然语言自助查询订单进度、产能负荷、下单推荐和交期估算。

**一句话**：输入订单号 → LLM 调度工具查询 SQL Server → SSE 流式返回格式化结果。

## 技术栈

| 层级 | 技术 | 作用 |
|-------|-----------|------|
| Agent 框架 | `@earendil-works/pi-coding-agent` | LLM 调度、工具定义、会话管理、上下文压缩 |
| AI 模型 | `@earendil-works/pi-ai` | 多供应商模型抽象（DeepSeek / OpenAI / Qwen / Anthropic / Google） |
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

| 容器 | 镜像来源 | 端口映射 | 职责 |
|------|---------|---------|------|
| `agent` | `Dockerfile.server` 本地构建 | `8000:8000`（内部调试用） | Hono SSE 服务 + pi_agent 核心 + SQL Server 客户端 |
| `web` | `Dockerfile.web` 本地构建 | `80:3000`（用户入口） | Next.js 前端 + Prisma SQLite 本地缓存 |

### 网络

两个容器通过 Docker bridge 网络 `agent-net` 内部通信：

```
web  ──HTTP──▶  agent:8000    （/api/chat、/api/sessions、/health）
web  ──HTTP──▶  外部 LLM API  （通过 agent 转发，web 不直接调 LLM）
agent ──TCP──▶  SQL Server    （172.18.28.88:1433，内网）
```

### 持久化

| 数据 | 存储位置 | 生命周期 |
|------|---------|---------|
| 会话记录 | Docker Volume `agent-sessions` → 容器内 `/root/.pi` | 永久（除非手动删除 volume） |
| 执行日志 | Docker Volume `agent-traces` → 容器内 `/app/data/logs/traces` | 永久（建议定期清理） |
| 配置/密钥 | `deploy/.env` 文件挂载 | 随宿主机文件 |

### 部署文件

| 文件 | 用途 |
|------|------|
| `docker-compose.yml` | 完整版：agent + web + nginx（需要外网拉 nginx 镜像） |
| `docker-compose.simple.yml` | 简化版：agent + web（无 nginx，适合离线/内网环境） |
| `Dockerfile.server` | agent 容器构建（node:20-alpine + tsx 运行时） |
| `Dockerfile.web` | web 容器构建（node:20-alpine + next build → next start） |
| `deploy/.env` | 生产环境变量（不入库、不入镜像） |
| `.dockerignore` | 排除 node_modules / .git / 文档 / 测试 等 |

### 启动命令

```bash
# 完整版（含 nginx 反代）
docker compose up -d --build

# 简化版（无 nginx，内网直接部署推荐）
docker compose -f docker-compose.simple.yml up -d --build
```

### 健康检查

| 端点 | 预期响应 |
|------|---------|
| `http://服务器IP:8000/health` | `{"status":"ok","service":"production-agent"}` |
| `http://服务器IP/health` | 同上（通过 web → agent 内部转发） |

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
3. **SQL Server** — 内网直连，encrypt=false。假设网络层已隔离
4. **LLM 输出** — LLM 文本输出不可信（可能幻觉），关键数据强制通过 tool 返回

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
