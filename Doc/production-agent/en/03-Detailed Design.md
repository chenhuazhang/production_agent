# Detailed Design

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

## 1. `queryOrderProgressTool` Detailed Design

### 1.1 `execute` Algorithm Flow

**Initialization**
1. `checkPermission("query_order_progress", params)`; return `{error: reason}` if denied.
2. Destructure `{ order_no, base }`; read `getCurrentUser()?.allowedBusinessTypes`.

**Core Logic (three branches)**
1. **base specified**:
   - If `allowed` exists and excludes `base` → return unsupported-scope error with allowed list.
   - `queryOrderProgress(order_no, base)` → return result if found.
   - Not found in main table → fall back to `queryPendingOrder(order_no)` → return `status:"待排产"` if hit.
   - Still nothing → return error with hints (wrong number / approval incomplete / beyond 3-month window / try other scopes).
2. **no base** → `queryOrderProgressMany(order_no, basesToQuery)` parallel over all scopes (`basesToQuery = allowed ?? ALL_BASE_NAMES`).
   - ≥1 hit → return `matches[]` (note if multiple).
   - None → fall back to registration tables → else error + hints.
3. **Exception (SQL failure)** → return `{error:"SQL Server query failed", detail, fallback, mock:getOrderInfo(order_no)}` (chat-only mock degradation).

## 2. `queryOrdersListTool` Detailed Design

### 2.1 `execute` Flow
1. Permission check. 2. Validate `since`/`until` as `YYYY-MM-DD`; `since <= until`. 3. `resolveBusinessTypes` (alias expansion; unknown alias → error with options). 4. Scope clamp by `allowed`, empty → error. 5. No filter → default 90-day window. 6. `queryOrdersList` → dispatch `total===0` (not found + hints) vs. results (with `by_type`/`by_line`/`truncated_note`). 7. SQL failure → error (no mock, unlike point lookup).

### 2.2 `queryOneTypeForList` Algorithm (data-layer core)
1. Fixed-base type conflicting with requested base → skip (no SQL), return `skipped`. 2. Run three parallel queries: detail (`TOP @limit`), count (`COUNT DISTINCT`), per-line count (`GROUP BY`). 3. Normalize dates, build `exceptions[]`. 4. Shanghai → `aggregateOrderLots`; others → dedupe by order number.

## 3. `checkPermission` Detailed Design

Steps (0→4): Step 0 unauthenticated (`requireCurrentUser` throws); Step 1 hard block (`DENY_ALWAYS` prefixes); Step 2 whitelist (unknown tool → supervisor only); Step 3 role set; Step 4 `paramCheck` (planner limited to own base).

## 4. `runPromptWithModelFallback` Detailed Design

### 4.1 `executeTurn` Branches
1. Subscribe; `suppressed=false`. 2. `message_end` with `stopReason==="error"` → suppress + stash message. 3. Otherwise forward via `onEvent`; suppress everything after. 4. After `runWithUser(prompt)`: ok / quota (`isQuota(errorMessage)`) / error.

### 4.2 Main Loop
Iterate `modelChain`; `setModel` if different; `executeTurn` → ok return / error return / quota → next model (warn). All exhausted → error listing the chain.

### 4.3 Quota Error Regex
Matches quota/exhausted/insufficient balance/arrears/欠费/额度不足/未开通/free-quota/trial-ended; excludes context-too-long and tool errors.

## 5. `formatSqlDatetime` Detailed Design

`Date`: NaN→null; year≤1900→null (sentinel); else format UTC components as `YYYY-MM-DD HH:mm` (restore Beijing wall-clock, avoid +8h drift). String: empty→null; `^(0000|1899|1900)-`→null; else as-is. Other→null. `normalizeRowDates` applies it to `Date` fields and the `TIME_FIELD_KEYS` whitelist.

## 6. `decorateProgressRow` Detailed Design

1. `STAGE_SPECS[type]` → `stages[]` (`done = time !== null`). 2. `done = row[COMPLETE_KEY[type]] != null` (small-trial = injection-strip time, OA = injection-strip time, others = final-complete time). 3. `current_stage`: null when done; otherwise next stage after last done stage, or first stage when nothing recorded. 4. Returns `{...row, stages, status, current_stage, current_stage_person}`.

## 7. `aggregateOrderLots` Detailed Design

1. Group by `order_no`. 2. Pick max `order_count` row as `lastLot`. 3. `lot_completed` = completed-lot count; `exceptions` = union across lots. 4. Output `{...lastLot, exceptions, lot_total, lot_completed}`.

## 8. SSE Event Handling Chain

`chat.ts` `onEvent`: 1. `tracer.record`. 2. `transformAgentEvent` → SSE events. 3. `agent_end` (and no footer yet) → prepend `REPLY_FOOTER` text_delta before done (footer not written to history, idempotent). 4. Error from fallback runner → push `error` event. Frontend `ai-client.ts` parses `\n\n`-framed SSE and dispatches callbacks; binds `X-Session-Id`.

## 9. MaxKB Session & Scope Routing

1. `buildPromptFromMessages` (ignore system; prefix history with `用户：`/`助手：`; `stripReplyFooter` on past assistant messages). 2. `resolveScopeByModel(body.model)` → scope. 3. `maxkbUser = {role:"supervisor", allowedBusinessTypes: scope.types}`; stateless `maxkb-<uuid>` session, `store.delete` after. 4. Stream → `chat.completion.chunk`; sync → aggregate to `chat.completion` (usage all -1).

## 10. Open API Status Dispatch

`GET /open/orders/progress`: validate `order_no` (required, ≤64) and `base` aliases → `queryOrderProgressMany` (no mock) → dispatch: ≥1 match → 200; all SQL-failed → 500; else 404. Audit via `logOpenApiEvent`.

## 11. Complexity Summary

| Algorithm | Complexity / Notes |
|-----------|-------------------|
| `queryOrderProgressMany` | O(5) parallel, `Promise.all` |
| `queryOrdersList` | O(types) parallel, 3 SQL each |
| `aggregateOrderLots` | O(n) single pass (Map) |
| `mergeByLine` | O(n·m) aggregate + sort |
| Model fallback chain | O(chain length) worst-case re-runs |