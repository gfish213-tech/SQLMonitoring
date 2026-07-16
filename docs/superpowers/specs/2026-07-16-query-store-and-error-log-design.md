# Query Store Regressions & Error Log panels — Design

## Why

The dashboard currently covers 12 known "the DB is slow" causes (blocking,
backups/long ops, agent jobs, resource consumers, waits, CPU/memory
pressure, tempdb, log space, IO latency, autogrowth, deadlocks, indexes),
but misses two common ones:

1. **A specific query's plan regressed** — it ran fine yesterday and is
   slow today, with no blocking, no resource pressure, nothing else
   obviously wrong. Query Store already tracks the history needed to spot
   this; nothing in the app reads it today.
2. **Something logged a real error** (corruption, out-of-memory, a
   severe failure) — currently invisible unless someone remotes into the
   box and opens the SQL Server error log file directly.

Both follow the existing "full-only check" pattern used by Autogrowth/
Deadlocks/IO Latency: a new `sql/*.ts` query module, a new tab, gated
behind Full Refresh (or per-tab refresh), fails soft (empty result) if
the underlying feature isn't available on that server.

## 1. Query Store Regressions

**File**: `server/src/sql/queryStoreRegressions.ts` (full-only tier)

- Enumerate databases where `is_query_store_on = 1 AND state = 0`.
- For each, run one query (dynamic SQL against the 3-part name) over
  `sys.query_store_runtime_stats` / `sys.query_store_runtime_stats_interval`
  / `sys.query_store_plan` / `sys.query_store_query` /
  `sys.query_store_query_text`: for each `query_id`, compare its most
  recent interval's avg duration/CPU against the average of the
  preceding intervals for the same query.
- **Regressed** = recent avg duration ≥ 3× the prior average **and**
  recent avg duration ≥ 1000ms (floor so trivial queries — e.g. 2ms →
  8ms — don't show up as noise).
- Each database's query is independently try/caught (one database's
  failure — older compat level, permissions — doesn't take down the
  others), mirroring `autogrowth.ts`/`deadlocks.ts`.
- Unlike Consumers, this is **capped**: top 25 rows server-wide by
  regression ratio, since Query Store history isn't naturally bounded by
  "currently executing" the way `sys.dm_exec_requests` is.
- New tab **Query Store**: Database, Query text (from
  `query_store_query_text`, truncated), Recent Avg Duration/CPU, Prior
  Avg Duration/CPU, Regression Ratio, Executions.
- `diagnosis.ts`: new finding — critical if ratio ≥ 5× or recent avg ≥
  5s, else warning. Advice: force the last-known-good plan
  (`sp_query_store_force_plan`) as immediate mitigation; update
  stats/rebuild indexes as the actual fix.

## 2. Error Log

**File**: `server/src/sql/errorLog.ts` (full-only tier)

- Read via `xp_readerrorlog` (current log, and the previous log file if
  needed to cover the window), filtered to the last 24 hours — same
  window convention as Autogrowth.
- Filter down to lines matching known-critical patterns: severity ≥ 16,
  or explicit corruption/failure signatures (823, 824, 825, out-of-memory
  701/17803, etc.) — not the routine startup/backup/checkpoint noise
  that dominates a raw error log.
- Wrapped in try/catch → empty array (matches `autogrowth.ts`/
  `deadlocks.ts`: `xp_readerrorlog` can be restricted by policy).
- New tab **Error Log**: Time, Severity, Message (truncated with
  full text available).
- `diagnosis.ts`: new finding — corruption (823/824/825) or
  out-of-memory is always critical and sorts first; other severity ≥ 16
  entries are warning.

## Shared wiring (both panels, following the existing full-only pattern)

- `types.ts`: `queryStoreRegressions` and `errorLogEntries` added as
  **optional** fields on `TriageData` (undefined = not checked, matching
  every other full-only field).
- `dashboard.ts`: both queries added to the full-only `Promise.all`
  batch; `PANEL_FETCHERS` gets two new entries for per-tab refresh.
- `useTriage.ts`: both panel keys added to `FULL_ONLY_PANELS`.
- `RefreshProgress.tsx`: both added to `PANEL_LABELS`.
- `App.tsx`'s `buildTabs()`: two new tabs, each rendering
  `NotCheckedPanel` when `hasData` is `undefined` (not yet checked this
  refresh), following the same tri-state dot pattern as every other tab.
- `summary.ts`: a section for each, capped (`MAX_QUERY_STORE_SHOWN`,
  `MAX_ERROR_LOG_SHOWN`) the same way Consumers/blocked-sessions/
  deadlocks are capped in the Copy-for-AI text.
- `CHANGELOG.md`: new entries under today's version heading.

## Testing

Server-side changes verified via `tsc --noEmit` and code review (the real
server can't boot in this sandbox — no ODBC driver/Windows). Client-side
changes (new tabs, `NotCheckedPanel` fallback, populated state) verified
against a mock Express server serving canned JSON matching the updated
`TriageData` shape, checked in a browser via Playwright — both the
not-checked and populated states for each new tab, per the project's
existing verification convention.

## Scope note

These are two independent panels sharing one implementation pattern —
built and committed as two separate steps, each following the standard
"new full-only check" checklist from `CLAUDE.md`. Neither depends on the
other.
