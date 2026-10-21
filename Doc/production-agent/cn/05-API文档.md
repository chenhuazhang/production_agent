# API 文档

**项目名称**：中试 AI 助手（production-agent）
**作者**：Administrator
**日期**：2026-08-27
**版本**：1.26.827.5

## 变更日志

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|----------|
| 1.26.827.5 | 2026-08-27 | Administrator | 生成项目文档套件（初始版本） |
| 1.26.708.5 | 2026-07-08 | chenhuazhang | 切换看板数据库：SQLite → PostgreSQL + 更新架构文档 |
| 1.26.707.4 | 2026-07-07 | chenhuazhang | feat: 侧边栏对话操作按钮 + 聊天建议快捷指令 |
| 1.26.706.3 | 2026-07-06 | chenhuazhang | feat: Dashboard 看板 + Docker 部署 + 权限系统 + 文档完善 |
| 1.26.702.2 | 2026-07-02 | chenhuazhang | chore: add Claude Code config and update dependencies |
| 1.26.629.1 | 2026-06-29 | unknown | Initial commit |

---

## 一、接口总览

### 1.1 REST（Hono 服务端，dev :8001）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/chat/:sessionId` | POST | SSE 聊天 |
| `/api/sessions` | GET | 会话列表 |
| `/api/sessions/pinned` | GET | 置顶 map |
| `/api/sessions/:sessionId` | GET | 会话详情 |
| `/api/sessions/:sessionId/rename` | PATCH | 重命名 |
| `/api/sessions/:sessionId/pin` | PATCH | 置顶/取消 |
| `/api/sessions/:sessionId` | DELETE | 删除 |
| `/health` | GET | 健康检查 |

### 1.2 OpenAI 兼容（MaxKB）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 虚拟模型列表 |
| `/v1/chat/completions` | POST | 同步 + 流式（stream=true） |

### 1.3 开放接口（外部系统）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/open/orders/progress` | GET | 订单进度点查 |
| `/open/orders/list` | GET | 订单列表（多维） |

### 1.4 Web API（Next.js）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/dashboard` | GET | 看板数据 |
| `/api/bases` | GET/POST | 基地列表/新增 |
| `/api/capacity` | GET | 产能数据 |

### 1.5 Agent 领域工具（LLM 可调用白名单）

`query_order_progress`、`query_orders_list`、`search_orders`、`get_production_stages`、`analyze_capacity`、`recommend_base`、`estimate_delivery`

## 二、接口详情

### 2.1 POST /api/chat/:sessionId

**请求体**：
```json
{ "text": "查 EX20260804-1042 进度", "user": { "userId": "u1", "role": "planner", "baseId": "gz" } }
```
> `user` 可选；缺省用 `ANON_USER(role=supervisor)`（鉴权未接入，生产前须替换）。

**响应**：`text/event-stream`，事件 `text_delta`/`thinking_delta`/`tool_start`/`tool_end`/`done`/`error`。

**响应头**：`X-Session-Id`（首条消息后回传持久化会话 id）。

**调用示例**：
```bash
curl -N -X POST http://localhost:8001/api/chat/sess-tmp1 \
  -H "Content-Type: application/json" \
  -d '{"text":"查 ZS-2026-001 进度"}'
```

### 2.2 POST /v1/chat/completions

**请求体**（标准 OpenAI 格式）：
```json
{ "model": "production-agent-gz", "messages": [{ "role": "user", "content": "我的订单进展" }], "stream": true }
```

**鉴权**：`Authorization: Bearer <SYNC_API_KEY>`。

**model 路由**：`production-agent`=全部；`production-agent-gz`=仅广州送样&小订单；`production-agent-main`=其余 4 类。

**同步响应**：
```json
{ "id": "chatcmpl-...", "object": "chat.completion", "model": "...", "choices": [{ "index": 0, "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }], "usage": { "prompt_tokens": -1, "completion_tokens": -1, "total_tokens": -1 } }
```

### 2.3 GET /open/orders/progress

**参数**：`order_no`（必填，≤64 字符）、`base`（可选，支持别名/逗号/重复参数）。

**鉴权**：`Authorization: Bearer <OPEN_API_KEY>`（未配置 key 时 fail-closed 503）。

**响应**（200）：
```json
{ "ok": true, "order_no": "...", "bases_queried": ["..."], "matches": [{ "base": "...", "rows": [{ "order_no": "...", "status": "生产中", "current_stage": "挤出", "stages": [...] }] }], "match_count": 1 }
```

**404**：`{ "ok": false, "error": { "code": "ORDER_NOT_FOUND", "message": "...", "hint": "..." } }`

**500**：`{ "ok": false, "error": { "code": "DB_ERROR", "message": "SQL Server 查询失败" } }`

### 2.4 GET /open/orders/list

**参数**（均可选）：`business_types`、`technician`、`base`、`grade`、`product_line`、`since`、`until`、`limit`（默认 200，上限 1000）。

**响应**（200）：`{ "ok": true, "bases_queried": [...], "total": N, "results": [ ... ] }`

### 2.5 领域工具参数

| 工具 | 参数 | 必填 |
|------|------|------|
| `query_order_progress` | `order_no`、`base?` | order_no |
| `query_orders_list` | `technician?`、`base?`、`grade?`、`product_line?`、`business_types?`、`since?`、`until?` | 全可选 |
| `search_orders` | `keyword` | keyword |
| `get_production_stages` | - | - |
| `analyze_capacity` | `base_name?` | - |
| `recommend_base` | - | - |
| `estimate_delivery` | `base_name`、`order_quantity?` | base_name |

## 三、异常场景

| 场景 | 返回结果 | 说明 |
|------|----------|------|
| 会话忙（并发请求同会话） | 429 `{error:"Session is busy"}` | busy 标志防并发 |
| 请求体 JSON 非法 | 400 `{error:"Invalid JSON"}` | - |
| text 为空 | 400 `{error:"Text is required"}` | - |
| 会话创建失败（缺 Key/模型） | 500 `{error: message}` | 带具体原因 |
| MaxKB 缺 messages | 400 `{error:{message:"messages is required"}}` | - |
| /v1 未配 SYNC_API_KEY | 放行 + 告警日志 | 仅开发 |
| /open 未配 OPEN_API_KEY | 503 fail-closed | 对外安全 |
| /open 缺 order_no | 400 `{code:"MISSING_PARAM"}` | - |
| /open 全业务 SQL 失败 | 500 `{code:"DB_ERROR"}` | 不谎报未找到 |
| /open 查无此单 | 404 `{code:"ORDER_NOT_FOUND"}` | - |
| 未知业务类型别名 | 400 `{code:"INVALID_PARAM"}` | 附可用清单 |
| since/until 格式错误 | 400 `{code:"INVALID_PARAM"}` | - |