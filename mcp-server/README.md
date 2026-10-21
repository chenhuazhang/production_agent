# Production Agent MCP Server（企微机器人插件后端）

把 `production_agent` 的「订单 / 生产进度智能问答」暴露成 **MCP（SSE 传输协议）**，
供企业微信「智能机器人」插件调用。用户在企微机器人里提问 → 企微调用本 MCP →
本服务转发给 production_agent（端口 8000）的 SSE 聊天接口 → 返回答案。

```
企微机器人  ──MCP/SSE──▶  本服务 (mcp-server, 端口 3000)  ──HTTP/SSE──▶  production_agent (端口 8000)
```

## 目录结构

```
mcp-server/
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── index.ts        # Express + MCP SSE 服务入口
    ├── config.ts       # 环境变量 / userid 提取
    └── agentClient.ts  # 转发问题到 production_agent 并聚合文本流
```

## 暴露的 MCP 工具

| 工具名 | 用途 |
|---|---|
| `query_production_order` | 订单进度 / 状态查询（指定订单在某基地的进度、负责人、工序、异常等） |
| `ask_production_agent` | 通用生产域问答（产能负荷、交期估算、下单基地推荐、多基地对比等） |

两个工具都接收 `question`（问题）与可选 `session_id`（多轮上下文）。

## 本地运行

```bash
cd production_agent/mcp-server
cp .env.example .env        # 按需修改：AGENT_API_BASE / MCP_API_KEY / MCP_PORT
npm install
npm run dev                 # 或 npm run build && npm start
```

健康检查：`GET http://localhost:<MCP_PORT>/health`

> 端口说明：默认 `MCP_PORT=3000`。若本机 3000 已被其他服务（如本仓库的 Plane）占用，
> 请改成其它端口（本机示例用 `3100`），插件 URL 相应改为 `https://你的域名:3100/sse`。
> 同时需保证本服务能访问 `AGENT_API_BASE`（production_agent，默认 8000）。

## 企业微信「智能机器人」插件配置

在企微管理后台「智能机器人 → 添加插件 → 自定义 MCP」中按如下填写：

| 配置项 | 填写内容 |
|---|---|
| **插件名称** | Production Agent 生产问答 |
| **插件描述** | 查询中试生产订单进度、产能负荷、交期估算与下单推荐 |
| **插件 URL** | `https://你的域名/sse`（即本服务的 `/sse` 端点；需为公网/企微可达的企业域名） |
| **请求头** | 无需手动填；企微在「仅配置企业域名 URL」时会自动在请求头注入提问者 `userid`（按 `USERID_HEADER` 读取，默认 `x-wecom-userid`） |
| **授权方式** | `Service token / API key` |
| **位置** | `Parameter name`（参数名方式，即放在 URL query 上） |
| **Parameter name** | `api_key` |
| **Service token / API key** | 与 `.env` 中 `MCP_API_KEY` 填**完全相同**的值 |
| **传输协议** | `SSE` |

> 说明：企微会把 `api_key=xxx` 作为 query 参数拼到插件 URL 上发起 SSE 连接；
> 本服务在 `/sse` 与 `/messages` 两个端点都做了 `api_key` 校验。
> 若填的是企业域名 URL，企微还会在请求头带上提问者 `userid`，可用于后续按用户隔离/审计。

## 与 production_agent 的对接说明

- 本服务通过 `POST {AGENT_API_BASE}/api/chat/:sessionId` 调用 production_agent，
  该接口以 SSE 流返回 `text_delta` 事件，本服务仅聚合文本后回传给企微。
- 若 production_agent 未启动或地址不可达，工具会返回友好的错误提示。
- `AGENT_API_BASE` 默认 `http://localhost:8000`，生产环境改为可达地址即可，无需改代码。

## 常见问题

- **企微连不上 SSE**：确认 `/sse` 与 `/messages` 都可被企微访问（放行防火墙 / 反向代理支持 SSE 长连接）。
- **401 unauthorized**：`MCP_API_KEY` 与企微插件里填的 Service token 不一致。
- **返回空答案 / 超时**：检查 production_agent 是否正常运行、`AGENT_API_BASE` 是否可达，必要时调大 `AGENT_API_TIMEOUT_MS`。
