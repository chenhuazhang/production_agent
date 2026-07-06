# Shipping Packet: 中试 AI 助手

**Repository**: `production_agent`
**Date**: 2026-07-06
**Status**: ⚠️ NOT READY TO SHIP — 4 launch blockers, 2 must-fix before pilot
**Reviewer**: __________________  **Sign-off**: __________________

---

## Documentation Inventory

| Doc | Status | Notes |
|-----|--------|-------|
| [architecture.md](documentation/architecture.md) | ✅ Created | System overview, stack, component diagram, trust boundaries, data flow |
| [flows.md](documentation/flows.md) | ✅ Created | 6 permission-relevant flows: order query, capacity, recommendation, search, dashboard, sessions |
| [permissions.md](documentation/permissions.md) | ✅ Created | 4 roles × 12 resources matrix, enforcement code paths, known gaps |
| [variables.md](documentation/variables.md) | ✅ Created | 12 env vars mapped to risk level + rotation + deployment notes |
| [automation.md](documentation/automation.md) | ✅ Created | Agent surface: 6 tools, guardrails, output contract, lifecycle |
| [tests.md](documentation/tests.md) | ✅ Created | Coverage map: 22 rules, 4 existing (guarded-live), 18 proposed, 7 gaps |
| README.md | ✅ Existing | Quickstart guide, accurate |
| AGENTS.md | ✅ Existing | Agent behavior spec (role, capabilities, routing) |
| CLAUDE.md | ✅ Created | Root-level agent operating context (derived from system docs) |
| Emails / Cron / SEO docs | N/A | No email, cron, or SEO features |

---

## Agent Context

- **CLAUDE.md**: ✅ Created at repo root — system identity, structure, trust boundaries, known issues, commands
- **AGENTS.md**: ✅ Existing — already serves as the LLM system prompt
- **web/CLAUDE.md**: ⚠️ Points to `@AGENTS.md` — functionally correct but could be a symlink or removed

---

## Security Summary

From [security-audit（安全审计）](security-audit（安全审计）.md) — **11 个发现**（2 Critical / 2 High / 4 Medium / 3 Low）

### Critical

| # | Finding | Attack | Impact | Fix |
|---|---------|--------|--------|-----|
| S1 | ANON_USER = supervisor (full access without auth) | No credentials needed → query all production data | All order/capacity/customer data exposed | Change ANON_USER.role to "sales", then add real auth |
| S2 | User identity forgeable via request body | Attacker sends `{user: {role: "supervisor"}}` | Bypasses all permission checks | Verify identity from JWT/SSO token, not request body |

### High

| # | Finding | Attack | Impact | Fix |
|---|---------|--------|--------|-----|
| S3 | Session APIs have zero auth | Anyone can GET/DELETE any session | Session history leak, data loss | Auth middleware on /api/sessions/* |
| S4 | CORS wildcard `*` + no auth = open CSRF | Any website can call the API | Cross-origin data theft | Restrict to known origins |

### Medium

- S5: Prompt injection (user text → LLM directly)
- S6: Error messages leak SQL schema details
- S7: No rate limiting → LLM API cost runaway risk
- S8: Session ID predictability risk (unconfirmed)

---

## Performance Summary

From [performance-audit（性能审计）](performance-audit（性能审计）.md) — **17 个发现**（5 High / 7 Medium / 5 Low）

### High Priority

| # | Finding | Recommendation | Effort |
|---|---------|---------------|--------|
| P1 | `tabdiytable3393` missing index on `f52977` | `CREATE INDEX idx_3393_order ON tabdiytable3393(f52977)` | Low |
| P2 | `tabdiytable3439` no composite index | `CREATE INDEX idx_3439_personnel ON tabdiytable3439(f136277, f53444, ID DESC)` | Low |
| P3 | `fetchAllDashboardOrders` 4 sequential queries | `Promise.allSettled()` parallelization | Low |
| P4 | Dashboard API fetches full orders then discards | SQL-level `TOP N` + aggregation queries | Medium |
| P5 | 上海中试 5-table JOIN too slow | Add composite indexes on 5724/5698/5699/5707/5711 | Low |

---

## Test Coverage

From [tests.md](documentation/tests.md):

| Category | Count | Status |
|----------|-------|--------|
| **Existing** (guarded-live) | 4 E2E scripts | Manual run only, no CI |
| **Proposed (unit)** | 12 test cases | Not written |
| **Proposed (integration)** | 6 test cases | Not written |
| **Proposed (guarded-live)** | 3 test cases | Not written |
| **Gaps (no verification)** | 7 rules | Ranked by exposure |

**Zero unit tests. Zero integration tests. Zero CI pipeline.**

---

## Launch Blockers

### 🚫 Must Fix Before Pilot (2-3 weeks)

| # | Blocker | Severity | What To Do |
|---|---------|----------|------------|
| **B1** | **No authentication** — ANON_USER=supervisor + forgeable body.user | Critical | 1) Set ANON_USER.role="sales"; 2) Add simple shared-secret header check as stopgap; 3) Schedule CRM SSO for Phase 2 |
| **B2** | **CORS wildcard** + no auth = open attack surface | Critical | Restrict CORS to known origins (`CORS_ORIGIN=...`) |
| **B3** | **Session API no auth** — history readable/deletable by anyone | High | Add same stopgap auth to /api/sessions/* |
| **B4** | **SQL `sa` account** — full sysadmin on production DB | Critical | Create readonly SQL login with `db_datareader` only |

### ⚡ Must Fix Before Scale (within pilot)

| # | Action | Why |
|---|--------|-----|
| B5 | Add rate limiter (per-session, 20 req/min) | Prevent LLM cost runaway |
| B6 | Add SQL indexes (P1, P2, P5) | Prevent query timeout at scale |
| B7 | Error messages sanitized (no SQL schema in responses) | Prevent information leakage |
| B8 | Parallelize dashboard queries (P3) | Dashboard latency under 2s |
| B9 | Docker secrets audit (.env not in image) | Prevent credential leak |

---

## Recommended Next Actions

### Immediate (this week)

1. **DBA**: Create readonly SQL account → update `SQL_USER`/`SQL_PASSWORD` in `.env`
2. **Backend dev**: Change `ANON_USER.role` from `"supervisor"` to `"sales"`; add shared-secret header check
3. **Backend dev**: Restrict CORS origin; add auth to `/api/sessions/*`
4. **DevOps**: Verify `.dockerignore` excludes `.env`; set up Docker secrets injection

### Short-term (within pilot prep)

5. **Backend dev**: Write 12 unit tests (PermissionGuard, Capacity formulas, SessionStore)
6. **Backend dev**: Add rate limiter + sanitize error messages
7. **DBA**: Apply 5 SQL indexes (confirm with `sp_spaceused` first)
8. **Backend dev**: Parallelize `getRealTimePendingCounts` and `fetchAllDashboardOrders`

### Medium-term (after pilot launch)

9. **Full team**: CRM SSO integration replaces stopgap auth
10. **Backend dev**: Replace sync I/O with async (ExecutionTracer, session routes)
11. **Backend dev**: Implement test CI gate (.github/workflows/test.yml)
12. **Product**: Schedule E1/E2 discussion (AI responsibility attribution, planner role impact)

---

## Reviewer Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tech Lead | | | |
| Product Owner | | | |
| Security Reviewer | | | |
| DBA | | | |

---

**Verdict**: ⚠️ **NOT READY TO SHIP.** The system has solid foundations (clean architecture, good permission design, parameterized SQL, proper tool whitelisting), but the authentication gap is critical — it undermines every security control in place. Fix the 4 launch blockers (B1-B4), then proceed to a controlled pilot with 3-5 power users. The remaining issues (B5-B9) can be addressed during the pilot without blocking initial use.
