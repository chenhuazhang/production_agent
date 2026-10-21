# Test Plan

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

## 1. Test Scope

- Agent tool layer (7 tools) — permission & execution
- SQL data layer (connection, 5 SQL sets, stage decoration, date normalization, list builder, lot aggregation)
- Permission & user context (ALS)
- Model fallback chain & business scoping
- Backend endpoints (chat/sessions/v1/open)
- Frontend (SSE consumption, dashboard, bases, capacity)
- Existing unit tests: `pi_agent/agent/services/sqlServer.test.ts`, `pi_agent/agent/modelFallback.test.ts`; E2E: `tests/e2e_sql.mjs`

## 2. Unit Test Cases

### 2.1 SQL Data Layer
#### Positive Cases
| Case ID | Name | Preconditions | Steps | Expected |
|---------|------|---------------|-------|----------|
| UT-SQL-001 | Point lookup hit | SQL reachable | `queryOrderProgress(no, base)` | found=true, rows with status/stages/current_stage |
| UT-SQL-002 | List triple stats | order exists | `queryOrdersList` | total/by_type/by_line consistent |
| UT-SQL-003 | Alias resolution | - | `resolveBusinessTypes(["研发实验"])` | `["小试"]` |
| UT-SQL-004 | Shanghai lot aggregation | multi-lot rows | `aggregateOrderLots` | one row/order, max lot, lot_total correct |

#### Negative Cases
| Case ID | Name | Preconditions | Steps | Expected |
|---------|------|---------------|-------|----------|
| UT-SQL-005 | Unknown business type | - | `queryOrderProgress(no, "不存在")` | throws with options |
| UT-SQL-006 | Unknown alias | - | `resolveBusinessTypes(["乱写"])` | throws with keywords |
| UT-SQL-007 | Sentinel normalization | row has `1900-01-01` | `formatSqlDatetime` | null |
| UT-SQL-008 | SQL connection failure | bad config | `getPool()` | clear error |

### 2.2 Permission & Context
| Case ID | Name | Preconditions | Steps | Expected |
|---------|------|---------------|-------|----------|
| UT-PERM-001 | Unauthenticated | no ALS | `checkPermission(...)` | throws |
| UT-PERM-002 | Write block | supervisor | `checkPermission("write_x")` | denied |
| UT-PERM-003 | Planner out of base | planner baseId=gz | `checkPermission(..., {base:"上海"})` | denied |
| UT-PERM-004 | Non-whitelist tool | non-supervisor | `checkPermission("bash")` | denied |

### 2.3 Model Fallback
| Case ID | Name | Preconditions | Steps | Expected |
|---------|------|---------------|-------|----------|
| UT-MF-001 | Quota detection | - | `isQuotaExhaustedError("insufficient quota")` | true |
| UT-MF-002 | Non-quota no fallback | - | `isQuotaExhaustedError("context too long")` | false |
| UT-MF-003 | Chain exhausted | 2 models all quota | `runPromptWithModelFallback` | error with chain list |

## 3. Concurrency Test Plan

| Scenario | Tool | Verify |
|----------|------|--------|
| Same-session concurrent | parallel POST script | second request 429 |
| Multi-session concurrency | `ab`/`k6` | pool reuse, no crosstalk |
| Pool exhaustion | high concurrency | waits/reuses, no crash |
| Multi-type parallel query | `Promise.all` | single failure doesn't affect others |

## 4. Boundary Condition Testing

- Date boundaries: `since==until==today`; `since>until` (reject); non-`YYYY-MM-DD` (reject)
- Window boundary: orders at month 3 ±1 day (hard limit)
- Order number: empty, >64 chars, case, with/without EX
- Lot boundaries: non-contiguous (1,2,7,9), single lot, all completed
- limit boundaries: 0 (reject), >1000 (clamp), negative
- Empty results: total=0; empty detail but non-zero stats (truncation)

## 5. Test Data Preparation

- **SQL Server source**: read-only; use known real order numbers (EX / non-EX / Shanghai multi-lot / OA)
- **Registration tables**: create not-yet-scheduled records
- **PostgreSQL seed**: `web/scripts/seed-orders.ts`; `count-pending.ts` / `test-all-sql.ts` verify
- **Mock data**: `pi_agent/data/mockData.ts` (`ZS-2026-001` etc.)
- **E2E**: `tests/e2e_sql.mjs` direct SQL connectivity check