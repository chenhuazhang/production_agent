# Overview Design

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

## 1. System Architecture

### 1.1 Design Patterns
- **Layered architecture**: frontend (Next.js) / backend (Hono) / agent core (pi_agent) / data layer (SQL Server)
- **Modular monorepo** with `pi_agent`, `server` and `web` workspaces
- **Singleton connection pool** (lazy init) + **AsyncLocalStorage** for user context propagation
- **Pure-function data layer** (`sqlServer.ts`) — query/decorate functions have no side effects, enabling unit tests and direct open-API reuse
- **Event-driven**: raw agent events → business events → SSE push / log persistence

### 1.2 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  web (Next.js): /chat  /dashboard  /bases  /capacity         │
└───────────────┬──────────────────────────────────────────────┘
                │ SSE / REST
┌───────────────▼──────────────────────────────────────────────┐
│  server (Hono, :8001)                                        │
│  /api/chat/:sessionId  /api/sessions/*                       │
│  /v1/* (OpenAI-compat, MaxKB)  /open/* (external)  /health   │
│  SessionStore (in-memory)  ExecutionTracer (trace persisting)│
└───────────────┬──────────────────────────────────────────────┘
                │ createSession()
┌───────────────▼──────────────────────────────────────────────┐
│  pi_agent (agent core): 7 domain tools + 3 skills + guard     │
│  services/sqlServer.ts (pool / 5 SQL sets / stage decoration) │
└───────────────┬──────────────────────────────────────────────┘
                │ mssql (read-only account)
┌───────────────▼──────────────────────────────────────────────┐
│  SQL Server (pilot production ERP, 5 business scopes)         │
└──────────────────────────────────────────────────────────────┘
                (dashboard fallback) → PostgreSQL (web/prisma seed data)
```

The LLM API (Bailian/DeepSeek) is an external dependency reached via `models.json` + `AI_API_KEY`.

## 2. Module Breakdown

| Module | Namespace | Responsibilities |
|--------|-----------|------------------|
| Agent core | `pi_agent/agent/` | LLM dispatch, tool definition, sessions, model assembly, events |
| Tool layer | `pi_agent/agent/tools.ts` | 7 domain tools (schema + permission + execution) |
| SQL data layer | `pi_agent/agent/services/sqlServer.ts` | pool, 5 SQL templates, stage decoration, list builder |
| Permission/context | `pi_agent/agent/services/` | `permissionGuard.ts`, `userContext.ts` |
| Business scoping | `pi_agent/agent/scopes.ts` | model name → allowed business types |
| Skills | `pi_agent/agent/skills/` | order-progress / capacity-analysis / output-format |
| Data & algorithms | `pi_agent/data/` | mock data, capacity algorithm (`capacity.ts`) |
| Backend routes | `server/src/routes/` | chat / sessions / openai_compat / open_api |
| Backend services | `server/src/services/` | sessionStore / executionTracer / logger / replyFooter |
| Web pages | `web/src/app/` | dashboard / chat / bases / capacity + api routes |
| Web libs | `web/src/lib/` | ai-client / sessions / sqlServer / prisma |

## 3. Class Diagram Relationships

```
AgentSession ──dispatch──▶ 7 Tools (defineTool)
     │                       │ execute() internally
     │                       ├─ checkPermission(tool,args) ──▶ requireCurrentUser() (ALS)
     │                       └─ queryOrderProgress / queryOrdersList / ... ──▶ sqlServer.ts
     │
     ├─ SessionManager (JSONL persistence + Compaction)
     ├─ ModelRegistry (models.json) + AuthStorage (API key)
     └─ ResourceLoader (injects AGENTS.md + 3 SKILL.md)

SessionStore (server) ──holds──▶ SessionEntry{session, modelChain, dispose}
ExecutionTracer ──subscribes──▶ AgentSession events ──▶ record()/finish()

UserContext (ALS) {role, baseId, allowedBusinessTypes} ──read by── permissionGuard / tools
```

## 4. Core Process Overview

1. **Order lookup**: user input → `/api/chat/:sessionId` → `SessionStore.getOrCreate` → `runPromptWithModelFallback` → LLM calls `query_order_progress` → tool queries SQL → JSON result → LLM formats → SSE stream → frontend.
2. **Multi-dimensional list**: LLM calls `query_orders_list` → alias expansion / scope clamp → three parallel queries (detail + count + per-line) → Shanghai lot aggregation → structured statistics.
3. **MaxKB multi-agent**: WeCom bot → MaxKB app → `/v1/chat/completions` (with model) → `resolveScopeByModel` → inject scopeNote + clamp businessTypes → stream result.
4. **Open API**: external system → `/open/orders/progress` (OPEN_API_KEY) → validate params → direct data layer (no mock) → 200/404/500 dispatch + audit logging.

## 5. Dependencies

| Dependency | Version/Source | Purpose |
|------------|------|------|
| `@earendil-works/pi-coding-agent` | local framework | LLM dispatch, tools, session management |
| `@earendil-works/pi-ai` | local framework | multi-provider model abstraction |
| `hono` + `@hono/node-server` | latest | HTTP + SSE routing |
| `mssql` | latest | SQL Server client |
| `@sinclair/typebox` | latest | tool parameter schemas |
| `dotenv` | latest | env loading |
| Next.js (App Router) | 14+ | frontend |
| Prisma | 5+ | dashboard local DB (PostgreSQL) |
| TypeScript | 5+ | full-stack language |