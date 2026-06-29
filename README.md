# Production Agent

中试生产管理 AI 聊天平台 —— 基于 [pi-coding-agent](https://github.com/earendil-works/pi-mono) 框架，为制造业生产调度场景定制的智能 Agent。

## 功能

- 📦 **订单进度查询** —— 直连 SQL Server 查询真实生产进度（负责人 / 各工序时间 / 异常信息）
- 🏭 **产能负荷分析** —— 多基地产能 / 负荷率 / 超负荷倍数 / 完工天数
- 🎯 **智能下单推荐** —— 基于实时负荷推荐最优下单基地
- 📅 **交期估算** —— 按基地 + 订单数量估算交期
- 💬 **流式对话** —— SSE 实时推送文本流 + 工具调用事件
- 💾 **会话持久化** —— JSONL 存储，支持历史回溯 / 分支 / fork
- 🧠 **自动压缩** —— 长对话上下文自动 Compaction
- 🔄 **多供应商** —— DeepSeek / OpenAI / Qwen / Anthropic / Google 等一键切换

## 架构

```
production_agent/
├── pi_agent/           # Agent 核心 workspace（基于 pi-coding-agent）
│   ├── agent/          # 会话、配置、工具、事件、技能定义
│   │   ├── services/   # SQL Server 连接服务
│   │   └── skills/     # 3 个 Markdown 行为规范（订单 / 产能 / 输出格式）
│   └── data/           # Mock 数据 + 产能公式
├── server/             # Hono SSE 服务（port 8000）
├── web/                # Next.js 前端（流式聊天界面）
├── tests/              # 端到端测试脚本
└── docs/               # 方案论证 + 设计文档
```

**技术栈**：TypeScript · pi-coding-agent · pi-ai · Hono · Next.js · SQL Server (mssql)

## 快速开始

### 前置条件

- Node.js ≥ 20
- 一个 LLM 供应商的 API Key（DeepSeek / OpenAI / 通义 / Anthropic / Google 任选）
- （可选）SQL Server 数据库用于真实订单进度查询

### 安装

```bash
# 克隆
git clone https://github.com/chenhuazhang/production_agent.git
cd production_agent

# 安装依赖（npm workspaces 自动安装 3 个 workspace）
npm install

# 配置环境变量
cp pi_agent/.env.example pi_agent/.env
# 编辑 pi_agent/.env：
#   AI_PROVIDER=deepseek
#   AI_API_KEY=your-key
#   AI_MODEL=deepseek-v4-flash
#   SQL_HOST=... （可选）
```

### 启动

```bash
# 启动 Agent + SSE 服务（port 8000）
npm run dev --workspace=server

# 另一个终端：启动 Web 前端
npm run dev --workspace=web
```

访问 Web 前端（默认 http://localhost:3000），即可开始对话：

- "查询 ZS-2026-001 在中试广州的生产进度"
- "推荐一个最适合下单的基地"
- "成都基地下单 20 吨要几天？"
- "对比一下五个基地的产能负荷"

## 自定义

### 添加新工具

在 `pi_agent/agent/tools.ts` 用 `defineTool` 定义 + TypeBox schema，加入 `agentTools` 数组与 `TOOL_NAMES`。

### 添加新 Skill（行为规范）

1. 在 `pi_agent/agent/skills/<name>/SKILL.md` 写 Markdown 规范
2. 在 `pi_agent/agent/config.ts` 添加 `Skill` 定义
3. 加入 `getDefaultSkills()` 返回值

### 切换 LLM 供应商

修改 `pi_agent/.env` 中的 `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL`，重启 server 即可。无需改代码。

## SSE 事件协议

`POST /api/chat/:sessionId` 返回 SSE 流，事件类型：

| event | data |
|---|---|
| `text_delta` | `{ delta: "..." }` |
| `tool_start` | `{ toolName, args }` |
| `tool_end` | `{ toolName, isError, result }` |
| `done` | `{}` |
| `error` | `{ message }` |

## 致谢

- 基于 [pi-coding-agent](https://github.com/earendil-works/pi-mono)（MIT）
- 参考了 [prd_agent](https://github.com/AltumSisy/prd_agent) 的项目结构

## License

MIT
