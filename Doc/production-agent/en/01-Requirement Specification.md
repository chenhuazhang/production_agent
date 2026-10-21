# Requirement Specification

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

## 1. Functional Overview

A pilot-production management AI chat platform built on the `pi-coding-agent` framework, structured as a TypeScript monorepo (`pi_agent` + Hono server + Next.js web).

Core goal: let sales staff look up **production progress, capacity load, base recommendation and delivery estimates** by entering an order number (or by technician / grade / product line), without consulting the planning desk.

One-line flow: user enters order number → the LLM dispatches domain tools to query SQL Server → formatted results streamed back over SSE.

Three served audiences: planning desk / pilot supervisor, sales center representatives, and technical center engineers.

## 2. Functional Requirement List

### 2.1 Order Progress Lookup (core)
- Single-order lookup: returns responsible person, completion time and exceptions per process stage
- 5 business scopes: Guangzhou Process Experiment / Guangzhou Samples & Small Orders / Small-Scale Trials (group-wide) / Shanghai Process Experiment / OA Auxiliary Orders (group-wide)
- Parallel query across all scopes when no scope is given
- Fallback to registration tables for not-yet-scheduled orders
- Multi-lot orders (Shanghai) presented per lot

### 2.2 Order List Query (multi-dimensional)
- Batch query by technician / grade / product line / business type / base / scheduling time range
- Business-type aliases (R&D trial = small-scale trial, process experiment = GZ+SH, etc.)
- Returns total, completed count and per-product-line statistics

### 2.3 Capacity Load Analysis
- Load rate, overload multiplier and days-to-complete for a single base or all bases

### 2.4 Base Recommendation
- Recommend the optimal base by lowest load rate with rationale

### 2.5 Delivery Estimate
- Estimate delivery days for a new order at a given base

### 2.6 Session Management
- Conversation history list, detail, rename, delete, pin
- JSONL persistence + automatic context compaction

### 2.7 Multi-Agent Scoping
- Constrain business scope by model name (`production-agent-gz` / `production-agent-main`)

### 2.8 Open API
- `/open/orders/progress` and `/open/orders/list` for programmatic external access

### 2.9 Production Dashboard (Web)
- Dashboard (KPI, process distribution, overdue/warning, top-5)
- Base management and capacity pages

## 3. Business Rule Requirements

### 3.1 Read-Only System
Production data is read-only; write/delete/update tool prefixes are hard-blocked in `permissionGuard`.

### 3.2 Data Window (hard 3-month limit)
All queries cover only orders with process activity in the last 3 months; report the window honestly rather than claiming an order does not exist.

### 3.3 Not-Yet-Scheduled Orders
Orders enter MYEXCEL for scheduling only after PLM and OA approval; before that they sit in registration tables, so the main tables won't find them.

### 3.4 Completion Signals
Small-scale trial: completion = injection-strip completion time. OA: completion = injection-strip time. Shanghai: order complete when the last lot completes.

### 3.5 Business-Type Aliases
R&D trial = small-scale trial; process experiment = GZ+SH process experiment; injection order / R&D auxiliary = OA auxiliary; sample / small order = GZ samples & small orders; "experiment orders" include OA auxiliary orders.

### 3.6 Permission Matrix
Roles `sales`/`engineer`/`planner`/`supervisor` can read; planner is limited to their own base.

### 3.7 Time Semantics
Returned times are Beijing wall-clock; "not set" values (`1900/1899` sentinels, empty strings) normalize to `null`, never reported as real completion.

## 4. Non-Functional Requirements

### 4.1 Performance
- SSE streaming with fast first token
- SQL Server connection pool reuse (agent max=10, web max=5), 30s request timeout
- Parallel query across business types (`Promise.all`)
- Detail lists truncated (`TOP 200`), statistics queried separately (untruncated)

### 4.2 Security
- All SQL parameterized (`@param`), no string concatenation
- Open API fail-closed: 503 if `OPEN_API_KEY` not configured
- Open API key (`OPEN_API_KEY`) isolated from MaxKB `SYNC_API_KEY`
- Tool whitelist: LLM may call only 7 domain tools, no filesystem/shell/network

### 4.3 Availability
- Model quota exhaustion auto-falls back to the next model in the chain
- SQL failure degrades to mock in chat only (open API never degrades)
- Sessions auto-cleared after 30 minutes of inactivity