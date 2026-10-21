# Deployment & User Manual

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

# Part 1: Deployment Manual

## 1. Environment Requirements

### 1.1 Runtime Environment
| Item | Requirement |
|------|-------------|
| OS | Windows 10+ / Linux (Docker) |
| Node.js | 22+ |
| Package manager | npm (monorepo workspaces) |

### 1.2 Dependency Components
| Component | Version | Purpose |
|-----------|---------|---------|
| SQL Server | internal ERP | source production data (read-only account) |
| PostgreSQL | 15+ | dashboard local DB (`web/prisma`) |
| LLM API | Bailian/DeepSeek | model inference (`AI_API_KEY`) |
| Docker | 20+ | containerized deployment |

## 2. Configuration Description

Main config `pi_agent/.env` (not committed, not baked into image):

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | model provider, default `bailian` |
| `AI_API_KEY` | model API key (required) |
| `AI_MODEL` | primary model, default `qwen3.8-max` |
| `AI_MODEL_FALLBACKS` | fallback chain, default `glm-5.2,qwen3.7-max` |
| `SQL_HOST`/`SQL_PORT`/`SQL_DB`/`SQL_USER`/`SQL_PASSWORD` | SQL Server connection |
| `PORT` | server port, default 8001 |
| `SYNC_API_KEY` | MaxKB (/v1) auth key |
| `OPEN_API_KEY` | open API (/open) auth key |

Web: `AI_API_URL` (default `http://127.0.0.1:8001`) and PostgreSQL `DATABASE_URL`. Model definitions in `deploy/models.json`.

## 3. Deployment Steps

### 3.1 Local dev
```bash
npm install
npm run dev --workspace=server   # backend :8001 (auto-loads pi_agent/.env)
npm run dev --workspace=web      # frontend :3001
```

### 3.2 Docker (production)
```bash
cp deploy/.env.production deploy/.env    # fill real secrets
docker compose -f docker-compose.simple.yml up -d --build   # internal network (no nginx)
# or with nginx:
docker compose up -d --build
# after first run / model change:
docker cp deploy/models.json <agent-container>:/root/.pi/agent/models.json
```

### 3.3 Database
```bash
cd web && npx prisma migrate deploy && npm run seed   # or web/scripts/seed-orders.ts
```

## 4. Operations Monitoring

| Metric/log | Location | Description |
|------------|----------|-------------|
| Health check | `GET /health` | returns `{status:"ok"}` |
| Session traces | `data/logs/traces/{date}.jsonl` | tools + duration + errors per request |
| Open API audit | `data/logs/open-api-requests.jsonl` | who queried what, when |
| MaxKB request log | `data/logs/maxkb-requests.jsonl` | model-name routing troubleshooting |
| Console log | stdout | `[scope]`-tagged |

Sessions auto-cleared after 30 min inactivity; traces/audit logs should be pruned periodically.

---

# Part 2: User Manual

## 1. Feature Operation Guide

### 1.1 Chat lookup (/chat)
- By order number: `Check EX20260804-1042 progress`
- By technician: `张三目前的订单情况`
- By dimension: `广州小试这一个月的订单`
- Capacity: `which base has low load` / `recommend a base` / `how long at XX base`
- Replies end with a feedback-form link; thinking chain and tool-call cards are collapsible

### 1.2 Production dashboard (/dashboard)
- Per-business-type KPI (in-progress/completed/overdue/warning/exceptions)
- Process distribution, top-5 active orders, overdue / near-due warning list

### 1.3 Base management (/bases)
- View base list, add a base (name/location/machine count/per-machine daily output)

### 1.4 Capacity (/capacity)
- Charts of load rate, daily capacity, pending orders, days-to-complete per base

## 2. Configuration Instructions

- End users have no configuration; admins adjust model, SQL connection and auth keys via `.env`
- Pin/rename/delete sessions from the sidebar conversation list

## 3. Common Troubleshooting

| Problem | Possible cause | Solution |
|---------|---------------|----------|
| Order not found | wrong number / approval incomplete / beyond 3-month window | check number, confirm PLM/OA approval, explain window |
| "待排产" returned | order registered but not scheduled | tell user it's registered, not yet scheduled |
| `[error] ...` reply | model quota exhausted / key invalid | check AI_API_KEY, top up or switch model |
| /v1 401 | SYNC_API_KEY mismatch | align keys on both sides |
| /open 503 | OPEN_API_KEY not configured | set it in `.env` |
| Empty session history | JSONL dir changed / not persisted | verify `PI_CODING_AGENT_DIR` and file paths |
| Dashboard empty | SQL unreachable and no seed | check SQL connection, run seed |
| Port conflict | Docker holds 8000/80 | use 8001/3001 for dev |