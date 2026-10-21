# Database Design

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

> The system uses three stores: **SQL Server** (source production ERP, read-only), **PostgreSQL** (dashboard seed DB), and **JSONL files** (sessions and logs).

## 1. Core Data Tables

### 1.1 SQL Server Source Tables (read-only, 5 business scopes)

| Business scope | Main table | Order-no col | JOIN tables | Notes |
|------|------|------|------|------|
| GZ Process Experiment | `tabdiytable3393` | `f52977` | `3946`(strip time), `7367`(technician) | order contains EX; personnel hard-coded |
| GZ Samples & Small Orders | `tabdiytable3393` | `f52977` | same | order without EX |
| Small-Scale Trial (group-wide) | `tabdiytable5992` | `f102935` | `7367`, `3439`(personnel ROW_NUMBER) | contains EX; completion `f102963` |
| SH Process Experiment | `tabdiytable5724` | `f96425` | `5698/5699/5707/5711/5625/5690` | starts with EX; technician in remark `f95728` |
| OA Auxiliary (group-wide) | `tabdiytable8460` | `f138799` | `8459`(base), `3439`(personnel) | injection only; completion `f138978` |

Registration tables (not-yet-scheduled orders):

| Table | Order no | Technician | Grade | Base | Registered at |
|------|------|------|------|------|------|
| `tabdiytable7367` | `F126876` | `F126815` | `F126820`(prefix) | `F126862` | `FillDate` |
| `tabdiytable7293` | `F125422` | `F125423` | `F125425` | `F126888` | `FillDate` |

### 1.2 Dashboard Local DB (PostgreSQL, `web/prisma`)

#### bases
| Field | Type | Description |
|------|------|-------------|
| id | String(cuid) | PK |
| name | String | base name |
| location | String | location |
| dataSource | String | business type |
| machineCount | Int | machine count |
| perMachineDailyOutput | Int | per-machine daily output |
| active | Boolean | enabled |

#### capacity_snapshots
| Field | Type | Description |
|------|------|-------------|
| id | String(cuid) | PK |
| baseId | String | FK → bases |
| pendingOrders | Int | pending count |
| dailyCapacity | Int | daily capacity |
| loadRate | Float | load rate |
| overloadMultiplier | Float | overload multiplier |
| daysToComplete | Float | days to complete |
| snapshotDate | DateTime | snapshot date |

#### orders
| Field | Type | Description |
|------|------|-------------|
| id | String(cuid) | PK |
| baseId | String | FK → bases |
| orderNumber | String(unique) | order number |
| productName | String | product name |
| customerName | String | customer name |
| machine | String? | machine |
| orderCount | Float | batch quantity |
| status | String | not_started/in_progress/completed |
| priority | String | normal/urgent |
| deliveryDate | DateTime | delivery date |
| currentStage | String? | current stage |
| extrusionException / injectionStripException / injectionColorPlateException | Boolean | three exception flags |

#### process_stages
| Field | Type | Description |
|------|------|-------------|
| id | String(cuid) | PK |
| orderId | String | FK → orders (cascade) |
| name | String | stage name |
| status | String | pending/in_progress/completed |
| person | String? | responsible person |
| completedAt | DateTime? | completion time |
| sortOrder | Int | ordering |

#### conversations / messages
Reserved tables; the actual conversation persistence uses Agent JSONL files, not these.

## 2. Table Relationships

```
SQL Server (read-only)        PostgreSQL (dashboard)         JSONL files (sessions)
───────────────               ─────────────────             ──────────────
tabdiytable3393 ...┐          bases 1─N capacity_snapshots  ~/.pi/agent/sessions/*.jsonl
grouped into 5      │          bases 1─N orders               data/session-meta.json (pins)
business scopes    │          orders 1─N process_stages       data/logs/traces/*.jsonl (traces)
                   │          base 1─N conversations          data/logs/open-api-requests.jsonl
                   └────────── conversation 1─N messages      (audit)
```

## 3. Index Recommendations

| Table | Index fields | Type | Description |
|------|-------------|------|-------------|
| orders | orderNumber | unique | exact order lookup |
| orders | baseId | normal | filter by base |
| process_stages | orderId, sortOrder | composite | stage ordering |
| capacity_snapshots | baseId, snapshotDate | composite | latest snapshot |
| SQL Server `tabdiytable3393` | f52977 | suggested (source system) | order lookups |
| SQL Server time columns | f52994/f140799 etc. | suggested | 3-month window filter |

> Source SQL Server tables belong to the pilot ERP and are read-only here; no new indexes are created by this project (raise slow Shanghai 5-way JOIN with the source DBA).