# API Documentation

**Project Name**: Pilot Production AI Assistant (production-agent)
**Author**: Administrator
**Date**: 2026-08-27
**Version**: 1.26.827.5

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.26.827.5 | 2026-08-27 | Administrator | Generated the project documentation suite (initial version) |
| 1.26.708.5 | 2026-07-08 | chenhuazhang | Switch dashboard DB: SQLite → PostgreSQL + update architecture doc |
| 1.26.707.4 | 2026-07-07 | chenhuazhang | feat: sidebar conversation actions + chat suggestion shortcuts |
| 1.26.706.3 | 2026-07-06 | chenhuazhang | feat: Dashboard + Docker deployment + permission system + docs |
| 1.26.702.2 | 2026-07-02 | chenhuazhang | chore: add Claude Code config and update dependencies |
| 1.26.629.1 | 2026-06-29 | unknown | Initial commit |

---

## 1. API Overview

### 1.1 REST (Hono backend, dev :8001)
| Endpoint | Method | Description |
|------|------|------|
| `/api/chat/:sessionId` | POST | SSE chat |
| `/api/sessions` | GET | session list |
| `/api/sessions/pinned` | GET | pin map |
| `/api/sessions/:sessionId` | GET | session detail |
| `/api/sessions/:sessionId/rename` | PATCH | rename |
| `/api/sessions/:sessionId/pin` | PATCH | pin/unpin |
| `/api/sessions/:sessionId` | DELETE | delete |
| `/health` | GET | health check |

### 1.2 OpenAI-Compatible (MaxKB)
| Endpoint | Method | Description |
|------|------|------|
| `/v1/models` | GET | virtual model list |
| `/v1/chat/completions` | POST | sync + streaming (`stream=true`) |

### 1.3 Open API (external systems)
| Endpoint | Method | Description |
|------|------|------|
| `/open/orders/progress` | GET | order progress lookup |
| `/open/orders/list` | GET | order list (multi-dimensional) |

### 1.4 Web API (Next.js)
| Endpoint | Method | Description |
|------|------|------|
| `/api/dashboard` | GET | dashboard data |
| `/api/bases` | GET/POST | base list/create |
| `/api/capacity` | GET | capacity data |

### 1.5 Agent domain tools (LLM-callable whitelist)
`query_order_progress`, `query_orders_list`, `search_orders`, `get_production_stages`, `analyze_capacity`, `recommend_base`, `estimate_delivery`

## 2. API Details

### 2.1 POST /api/chat/:sessionId
**Request body**:
```json
{ "text": "Check EX20260804-1042 progress", "user": { "userId": "u1", "role": "planner", "baseId": "gz" } }
```
> `user` optional; defaults to `ANON_USER(role=supervisor)` (auth not yet wired — must be replaced pre-production).

**Response**: `text/event-stream` with events `text_delta` / `thinking_delta` / `tool_start` / `tool_end` / `done` / `error`. Response header `X-Session-Id` returns the persisted session id.

**Example**:
```bash
curl -N -X POST http://localhost:8001/api/chat/sess-tmp1 \
  -H "Content-Type: application/json" -d '{"text":"Check ZS-2026-001 progress"}'
```

### 2.2 POST /v1/chat/completions
**Request** (standard OpenAI format):
```json
{ "model": "production-agent-gz", "messages": [{ "role": "user", "content": "my order progress" }], "stream": true }
```
**Auth**: `Authorization: Bearer <SYNC_API_KEY>`. **Model routing**: `production-agent` = all; `production-agent-gz` = GZ samples & small orders only; `production-agent-main` = the other 4.

**Sync response**: standard `chat.completion` JSON with `usage` fields all `-1`.

### 2.3 GET /open/orders/progress
**Params**: `order_no` (required, ≤64 chars), `base` (optional, aliases/commas/repeat supported). **Auth**: `Authorization: Bearer <OPEN_API_KEY>` (fail-closed 503 if key not set).

**200**:
```json
{ "ok": true, "order_no": "...", "bases_queried": ["..."], "matches": [{ "base": "...", "rows": [{ "order_no": "...", "status": "生产中", "current_stage": "挤出", "stages": [...] }] }], "match_count": 1 }
```
**404**: `{ "ok": false, "error": { "code": "ORDER_NOT_FOUND", ... } }`
**500**: `{ "ok": false, "error": { "code": "DB_ERROR", ... } }`

### 2.4 GET /open/orders/list
**Params** (all optional): `business_types`, `technician`, `base`, `grade`, `product_line`, `since`, `until`, `limit` (default 200, max 1000). **200**: `{ "ok": true, "bases_queried": [...], "total": N, "results": [...] }`.

### 2.5 Domain tool params
| Tool | Params | Required |
|------|--------|----------|
| `query_order_progress` | `order_no`, `base?` | order_no |
| `query_orders_list` | `technician?`, `base?`, `grade?`, `product_line?`, `business_types?`, `since?`, `until?` | all optional |
| `search_orders` | `keyword` | keyword |
| `get_production_stages` | - | - |
| `analyze_capacity` | `base_name?` | - |
| `recommend_base` | - | - |
| `estimate_delivery` | `base_name`, `order_quantity?` | base_name |

## 3. Exception Scenarios

| Scenario | Result | Description |
|----------|--------|-------------|
| Busy session | 429 `{error:"Session is busy"}` | busy flag prevents concurrency |
| Invalid JSON | 400 `{error:"Invalid JSON"}` | - |
| Empty text | 400 `{error:"Text is required"}` | - |
| Session creation failure | 500 `{error: message}` | with reason |
| MaxKB missing messages | 400 `{error:{message:"messages is required"}}` | - |
| /v1 without SYNC_API_KEY | allowed + warning log | dev only |
| /open without OPEN_API_KEY | 503 (fail-closed) | external security |
| /open missing order_no | 400 `{code:"MISSING_PARAM"}` | - |
| /open all SQL failed | 500 `{code:"DB_ERROR"}` | never fake "not found" |
| /open not found | 404 `{code:"ORDER_NOT_FOUND"}` | - |
| Unknown business type alias | 400 `{code:"INVALID_PARAM"}` | with options |
| Invalid since/until | 400 `{code:"INVALID_PARAM"}` | - |