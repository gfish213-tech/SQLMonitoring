# Query Store Regressions & Error Log Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new full-only diagnostic tabs — **Query Store Regressions** (queries that got slower than their own recent history) and **Error Log** (severity ≥16 entries from the last 24h) — following the exact "full-only check" pattern every existing tab already uses.

**Architecture:** Each feature is a new `server/src/sql/*.ts` query module wired into the existing Full-Refresh `Promise.all` batch and per-tab `PANEL_FETCHERS` map, an optional field on `TriageData`, a new client panel component, a new tab in `App.tsx`'s `buildTabs()`, a `diagnosis.ts` finding, and a `summary.ts` section — the same eight touch-points every prior full-only panel (Autogrowth, Deadlocks, IO Latency, ...) already went through. No new architecture, no new dependencies.

**Tech Stack:** TypeScript, Express, `mssql`/`msnodesqlv8` (server); React + Vite (client). No test runner is configured in this repo — verification is `npm run build` (which runs `tsc`) plus manual browser checks against a throwaway mock Express server, per this project's own documented "Verifying changes" convention (the real server needs a Windows host with the ODBC driver, which isn't available here).

## Global Constraints

- Follow the existing full-only-check pattern exactly (see `server/src/sql/autogrowth.ts` / `deadlocks.ts` for the shape): fail-soft to `[]` on any query error, never throw out of the exported function.
- New `TriageData` fields are **optional** (`fieldName?: Type[]`) — `undefined` means "not checked this refresh," distinct from `[]` ("checked, nothing found"). Every consumer (tab dot, `NotCheckedPanel`, `summary.ts`) must treat these as three states, not two.
- Both checks are **full-only** (gated behind Full Refresh / their own per-tab refresh button), never added to `QUICK_PANELS`.
- New tab keys: `"querystore"` and `"errorlog"`. New `TriageData`/panel-tracking field names: `queryStoreRegressions` and `errorLogEntries` — used verbatim as the `tracked()`/`PANEL_LABELS`/`FULL_ONLY_PANELS` key in every file that needs it, so grepping one name finds every wiring point.
- No new npm dependencies in either project.
- Verify server changes with `cd server && npm run build` (runs `tsc -p tsconfig.json`, catches type errors without needing a live DB). Verify client changes with `cd client && npm run build` (runs `tsc -b && vite build`).
- Commit after each task.

---

## Phase 1: Query Store Regressions

### Task 1: Server query module — `queryStoreRegressions.ts`

**Files:**
- Create: `server/src/sql/queryStoreRegressions.ts`

**Interfaces:**
- Consumes: `getPool()` and `getActiveConnectionMeta()` from `server/src/db.ts` (both already exported).
- Produces: `export interface QueryStoreRegression { databaseName: string; queryId: number; queryText: string; recentAvgDurationMs: number; priorAvgDurationMs: number; recentAvgCpuMs: number; priorAvgCpuMs: number; regressionRatio: number; executionCount: number; }` and `export async function getQueryStoreRegressions(): Promise<QueryStoreRegression[]>` — this is what `dashboard.ts` (Task 2) imports.

- [ ] **Step 1: Write the module**

```typescript
import { getPool, getActiveConnectionMeta } from "../db";

export interface QueryStoreRegression {
  databaseName: string;
  queryId: number;
  queryText: string;
  recentAvgDurationMs: number;
  priorAvgDurationMs: number;
  recentAvgCpuMs: number;
  priorAvgCpuMs: number;
  regressionRatio: number;
  executionCount: number;
}

interface RawRegressionRow {
  query_id: number;
  recent_avg_duration_ms: number;
  prior_avg_duration_ms: number;
  recent_avg_cpu_ms: number;
  prior_avg_cpu_ms: number;
  regression_ratio: number;
  execution_count: number;
  query_text: string;
}

// A query that quietly got slower - with nothing else in the app (blocking, pressure, I/O)
// obviously explaining it - is one of the most common "it was fine yesterday" causes, and Query
// Store already tracks the history needed to spot it. Query Store is a per-database feature
// (unlike the server-wide DMVs the rest of this app reads), so this loops over every database
// that has it enabled - bounded by database count, not row count, unlike the per-row
// cross-database lookups indexStats.ts deliberately avoids.
function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

// One query_id can appear more than once in the same interval when it has multiple plans
// (parameter sniffing, plan flips); interval_stats collapses those into one execution-weighted
// average per (query_id, interval) first, so ranking by start_time compares whole intervals, not
// a coin flip between two same-time rows. rn = 1 is the most recent interval; rn 2-6 is that same
// query's own recent history (roughly the last several hours at the default 60-minute
// interval_length_minutes) - a query is judged regressed against itself, not a fixed threshold,
// so a query that's always been slow doesn't fire, and a fast query that got 3x slower does.
const REGRESSION_QUERY = `
;WITH interval_stats AS (
  SELECT
    rs.query_id,
    rsi.start_time,
    SUM(rs.avg_duration * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS interval_avg_duration,
    SUM(rs.avg_cpu_time * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS interval_avg_cpu,
    SUM(rs.count_executions) AS interval_executions
  FROM sys.query_store_runtime_stats rs
  INNER JOIN sys.query_store_runtime_stats_interval rsi
    ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
  WHERE rs.execution_type = 0
    AND rsi.start_time > DATEADD(HOUR, -24, GETUTCDATE())
  GROUP BY rs.query_id, rsi.start_time
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY query_id ORDER BY start_time DESC) AS rn
  FROM interval_stats
),
agg AS (
  SELECT
    query_id,
    MAX(CASE WHEN rn = 1 THEN interval_avg_duration END) AS recent_avg_duration,
    MAX(CASE WHEN rn = 1 THEN interval_avg_cpu END) AS recent_avg_cpu,
    MAX(CASE WHEN rn = 1 THEN interval_executions END) AS recent_executions,
    AVG(CASE WHEN rn BETWEEN 2 AND 6 THEN interval_avg_duration END) AS prior_avg_duration,
    AVG(CASE WHEN rn BETWEEN 2 AND 6 THEN interval_avg_cpu END) AS prior_avg_cpu,
    COUNT(CASE WHEN rn BETWEEN 2 AND 6 THEN 1 END) AS prior_interval_count
  FROM ranked
  GROUP BY query_id
)
SELECT TOP 25
  agg.query_id,
  agg.recent_avg_duration / 1000.0 AS recent_avg_duration_ms,
  agg.prior_avg_duration / 1000.0 AS prior_avg_duration_ms,
  agg.recent_avg_cpu / 1000.0 AS recent_avg_cpu_ms,
  agg.prior_avg_cpu / 1000.0 AS prior_avg_cpu_ms,
  agg.recent_avg_duration * 1.0 / NULLIF(agg.prior_avg_duration, 0) AS regression_ratio,
  agg.recent_executions AS execution_count,
  qt.query_sql_text AS query_text
FROM agg
INNER JOIN sys.query_store_query q ON q.query_id = agg.query_id
INNER JOIN sys.query_store_query_text qt ON qt.query_text_id = q.query_text_id
WHERE agg.prior_interval_count >= 2
  AND agg.recent_avg_duration >= 1000000
  AND agg.recent_avg_duration >= agg.prior_avg_duration * 3
ORDER BY regression_ratio DESC;
`;

async function getRegressionsForDatabase(dbName: string, originalDb: string): Promise<QueryStoreRegression[]> {
  const pool = getPool();
  try {
    // USE, the query, and USE back all run as one batch on whichever physical connection the
    // pool hands this call - splitting this across separate pool.request() calls can't guarantee
    // the same connection, which would leave a pooled connection parked on the wrong database
    // for whatever unrelated query runs on it next (the exact bug tempdb.ts's own comments
    // describe FILEPROPERTY hitting from the opposite direction).
    const result = await pool.request().query(`
      USE ${quoteIdent(dbName)};
      ${REGRESSION_QUERY}
      USE ${quoteIdent(originalDb)};
    `);
    return (result.recordset as RawRegressionRow[]).map((row) => ({
      databaseName: dbName,
      queryId: row.query_id,
      queryText: row.query_text,
      recentAvgDurationMs: row.recent_avg_duration_ms,
      priorAvgDurationMs: row.prior_avg_duration_ms,
      recentAvgCpuMs: row.recent_avg_cpu_ms,
      priorAvgCpuMs: row.prior_avg_cpu_ms,
      regressionRatio: row.regression_ratio,
      executionCount: row.execution_count,
    }));
  } catch {
    // Older compat level, Query Store in a transitioning state (e.g. READ_ONLY after hitting its
    // size cap), or a permissions hiccup on this one database shouldn't take down every other
    // database's results - same fail-soft-per-item shape as blocking.ts's per-lead-blocker work.
    return [];
  }
}

// Query Store is enabled per-database (unlike every other DMV this app reads, which is
// server-wide) - is_query_store_on tells us which databases to even bother checking.
export async function getQueryStoreRegressions(): Promise<QueryStoreRegression[]> {
  const pool = getPool();
  const originalDb = getActiveConnectionMeta()?.database ?? "master";

  let dbNames: string[];
  try {
    const dbResult = await pool.request().query(`
      SELECT name FROM sys.databases WHERE is_query_store_on = 1 AND state = 0
    `);
    dbNames = dbResult.recordset.map((row) => row.name as string);
  } catch {
    return [];
  }

  const perDatabase = await Promise.all(dbNames.map((name) => getRegressionsForDatabase(name, originalDb)));
  // Capped, unlike Consumers - Query Store history isn't naturally bounded by "currently
  // executing" the way sys.dm_exec_requests is, so a busy multi-database server could otherwise
  // return hundreds of rows.
  return perDatabase
    .flat()
    .sort((a, b) => b.regressionRatio - a.regressionRatio)
    .slice(0, 25);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run build`
Expected: exits 0, no TypeScript errors, `dist/sql/queryStoreRegressions.js` is produced.

- [ ] **Step 3: Commit**

```bash
git add server/src/sql/queryStoreRegressions.ts
git commit -m "Add Query Store regression detection query"
```

---

### Task 2: Wire into `dashboard.ts`

**Files:**
- Modify: `server/src/routes/dashboard.ts`

**Interfaces:**
- Consumes: `getQueryStoreRegressions` from Task 1 (`../sql/queryStoreRegressions`).
- Produces: `queryStoreRegressions` field in the `/triage` full-mode `done` payload and a `querystore` entry in `PANEL_FETCHERS`, both of which Task 3 (`types.ts`) and Task 7 (`App.tsx`) rely on by name.

- [ ] **Step 1: Add the import**

In `server/src/routes/dashboard.ts`, add this line after the existing `import { getVolumeSpace } from "../sql/volumeSpace";` (line 15):

```typescript
import { getQueryStoreRegressions } from "../sql/queryStoreRegressions";
```

- [ ] **Step 2: Add it to the full-only `Promise.all` batch**

Replace this block (lines 125–132):

```typescript
    const [tempdb, vlfCounts, ioLatency, autogrowth, deadlocks, volumeSpace] = await Promise.all([
      tracked(emit, "tempdb", getTempdbStats()),
      tracked(emit, "vlfCounts", getVlfCounts()),
      tracked(emit, "ioLatency", getIoLatency()),
      tracked(emit, "autogrowth", getRecentAutogrowthEvents()),
      tracked(emit, "deadlocks", getRecentDeadlocks()),
      tracked(emit, "volumeSpace", getVolumeSpace()),
    ]);
```

with:

```typescript
    const [tempdb, vlfCounts, ioLatency, autogrowth, deadlocks, volumeSpace, queryStoreRegressions] = await Promise.all([
      tracked(emit, "tempdb", getTempdbStats()),
      tracked(emit, "vlfCounts", getVlfCounts()),
      tracked(emit, "ioLatency", getIoLatency()),
      tracked(emit, "autogrowth", getRecentAutogrowthEvents()),
      tracked(emit, "deadlocks", getRecentDeadlocks()),
      tracked(emit, "volumeSpace", getVolumeSpace()),
      tracked(emit, "queryStoreRegressions", getQueryStoreRegressions()),
    ]);
```

- [ ] **Step 3: Add it to the `done` payload**

Replace the `emit({ type: "done", data: { ... } })` block (lines 134–152) with:

```typescript
    emit({
      type: "done",
      data: {
        overview,
        blocking,
        longOps,
        agentJobs,
        waits,
        pressure,
        logSpace,
        consumers,
        tempdb,
        vlfCounts,
        ioLatency,
        autogrowth,
        deadlocks,
        volumeSpace,
        queryStoreRegressions,
      },
    });
```

- [ ] **Step 4: Add the per-tab fetcher**

In the `PANEL_FETCHERS` map, add a new entry right after `deadlocks` (after line 187):

```typescript
  querystore: async () => ({ queryStoreRegressions: await labeled("queryStoreRegressions", getQueryStoreRegressions()) }),
```

- [ ] **Step 5: Typecheck**

Run: `cd server && npm run build`
Expected: exits 0. (`types.ts` doesn't exist server-side — this compiles even though the client's `TriageData` doesn't know about the new field yet, since the server has no shared-type dependency on the client.)

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/dashboard.ts
git commit -m "Wire Query Store regressions into the Full Refresh batch and per-tab fetch"
```

---

### Task 3: Client types — `types.ts`

**Files:**
- Modify: `client/src/types.ts`

**Interfaces:**
- Produces: `QueryStoreRegression` interface, `TriageData.queryStoreRegressions?: QueryStoreRegression[]`, and `"querystore"` added to the `DashboardTab` union — every later client task in this phase depends on these three.

- [ ] **Step 1: Add the `QueryStoreRegression` interface**

Add this after the `IndexStats` interface (after line 196):

```typescript
export interface QueryStoreRegression {
  databaseName: string;
  queryId: number;
  queryText: string;
  recentAvgDurationMs: number;
  priorAvgDurationMs: number;
  recentAvgCpuMs: number;
  priorAvgCpuMs: number;
  regressionRatio: number;
  executionCount: number;
}
```

- [ ] **Step 2: Add `"querystore"` to `DashboardTab`**

Change:

```typescript
export type DashboardTab =
  | "overview"
  | "blocking"
  | "consumers"
  | "longops"
  | "agentjobs"
  | "waits"
  | "logspace"
  | "iolatency"
  | "autogrowth"
  | "deadlocks"
  | "indexes";
```

to:

```typescript
export type DashboardTab =
  | "overview"
  | "blocking"
  | "consumers"
  | "longops"
  | "agentjobs"
  | "waits"
  | "logspace"
  | "iolatency"
  | "autogrowth"
  | "deadlocks"
  | "querystore"
  | "indexes";
```

- [ ] **Step 3: Add the optional field to `TriageData`**

Change:

```typescript
  volumeSpace?: VolumeSpaceRow[];
  indexStats?: IndexStats;
}
```

to:

```typescript
  volumeSpace?: VolumeSpaceRow[];
  queryStoreRegressions?: QueryStoreRegression[];
  indexStats?: IndexStats;
}
```

- [ ] **Step 4: Typecheck (expect failures — that's fine, this task only adds types)**

Run: `cd client && npx tsc -b --noEmit`
Expected: no errors from `types.ts` itself. (Nothing consumes the new tab/field yet, so this alone can't break anything — proceed to Task 4.)

- [ ] **Step 5: Commit**

```bash
git add client/src/types.ts
git commit -m "Add QueryStoreRegression type and querystore tab key"
```

---

### Task 4: `useTriage.ts` — register as full-only panel

**Files:**
- Modify: `client/src/hooks/useTriage.ts`

- [ ] **Step 1: Add to `FULL_ONLY_PANELS`**

Change:

```typescript
const FULL_ONLY_PANELS = ["tempdb", "vlfCounts", "ioLatency", "autogrowth", "deadlocks", "volumeSpace"];
```

to:

```typescript
const FULL_ONLY_PANELS = ["tempdb", "vlfCounts", "ioLatency", "autogrowth", "deadlocks", "volumeSpace", "queryStoreRegressions"];
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useTriage.ts
git commit -m "Track Query Store regressions in the Full Refresh progress checklist"
```

---

### Task 5: `RefreshProgress.tsx` — panel label

**Files:**
- Modify: `client/src/components/RefreshProgress.tsx`

- [ ] **Step 1: Add the label**

Change:

```typescript
  volumeSpace: "Volume Space",
  indexStats: "Indexes",
};
```

to:

```typescript
  volumeSpace: "Volume Space",
  queryStoreRegressions: "Query Store",
  indexStats: "Indexes",
};
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/RefreshProgress.tsx
git commit -m "Add Query Store label to the refresh progress checklist"
```

---

### Task 6: `QueryStorePanel.tsx` component

**Files:**
- Create: `client/src/components/QueryStorePanel.tsx`

**Interfaces:**
- Consumes: `Section` from `./Section`, `truncate` from `../format`, `QueryStoreRegression` from `../types`.
- Produces: `export function QueryStorePanel({ queryStoreRegressions }: { queryStoreRegressions: QueryStoreRegression[] })` — consumed by Task 7 (`App.tsx`).

- [ ] **Step 1: Write the component**

```tsx
import { Section } from "./Section";
import { truncate } from "../format";
import type { QueryStoreRegression } from "../types";

export function QueryStorePanel({ queryStoreRegressions }: { queryStoreRegressions: QueryStoreRegression[] }) {
  return (
    <Section
      id="panel-querystore"
      title="Query Store Regressions"
      badge={<span className="panel-hint">queries ≥3x slower than their own recent average · last 24h · Query Store-enabled databases only</span>}
      isEmpty={queryStoreRegressions.length === 0}
      emptyText="No query has regressed against its own recent history in any Query Store-enabled database."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Database</th>
              <th>Query</th>
              <th className="num">Recent Avg</th>
              <th className="num">Prior Avg</th>
              <th className="num">Ratio</th>
              <th className="num">Recent CPU</th>
              <th className="num">Executions</th>
            </tr>
          </thead>
          <tbody>
            {queryStoreRegressions.map((row) => (
              <tr key={`${row.databaseName}-${row.queryId}`}>
                <td>{row.databaseName}</td>
                <td title={row.queryText}>{truncate(row.queryText, 120)}</td>
                <td className="num">{row.recentAvgDurationMs.toFixed(0)} ms</td>
                <td className="num">{row.priorAvgDurationMs.toFixed(0)} ms</td>
                <td className="num">{row.regressionRatio.toFixed(1)}x</td>
                <td className="num">{row.recentAvgCpuMs.toFixed(0)} ms</td>
                <td className="num">{row.executionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/QueryStorePanel.tsx
git commit -m "Add Query Store Regressions panel component"
```

---

### Task 7: Wire the tab into `App.tsx`

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Import the component**

Add after the `IndexStatsPanel` import (after line 19):

```typescript
import { QueryStorePanel } from "./components/QueryStorePanel";
```

- [ ] **Step 2: Add the tab entry in `buildTabs()`**

Insert this new object into the returned array, right after the `deadlocks` entry (after line 89, before the `indexes` entry):

```typescript
    {
      key: "querystore",
      label: "Query Store",
      hasData: data.queryStoreRegressions ? data.queryStoreRegressions.length > 0 : undefined,
      node: data.queryStoreRegressions ? (
        <QueryStorePanel queryStoreRegressions={data.queryStoreRegressions} />
      ) : (
        <NotCheckedPanel label="Query Store Regressions" />
      ),
    },
```

- [ ] **Step 3: Update the Full Refresh button's tooltip**

Change (line 167):

```tsx
            title="Adds heavier checks: TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space. Indexes isn't included — it's slow on servers with many databases; refresh it from its own tab."
```

to:

```tsx
            title="Adds heavier checks: TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, Query Store. Indexes isn't included — it's slow on servers with many databases; refresh it from its own tab."
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run build`
Expected: exits 0, `client/dist` is produced with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "Add Query Store tab to the dashboard"
```

---

### Task 8: `diagnosis.ts` finding + `DiagnosisSummary.tsx` jump link

**Files:**
- Modify: `client/src/diagnosis.ts`
- Modify: `client/src/components/DiagnosisSummary.tsx`

- [ ] **Step 1: Add the finding loop**

In `client/src/diagnosis.ts`, insert this right after the deadlocks block (after line 257, before `return findings.sort(...)`):

```typescript
  for (const qs of data.queryStoreRegressions ?? []) {
    findings.push({
      severity: qs.regressionRatio >= 5 || qs.recentAvgDurationMs >= 5000 ? "critical" : "warning",
      panel: "Query Store",
      title: `A query on ${qs.databaseName} is running ${qs.regressionRatio.toFixed(1)}x slower than its own recent average`,
      detail: `Recent avg ${qs.recentAvgDurationMs.toFixed(0)}ms vs. prior avg ${qs.priorAvgDurationMs.toFixed(0)}ms, ${qs.executionCount} execution(s) in the latest interval.`,
      advice: `Open the Query Store tab to see the query text. Immediate mitigation: force the last-known-good plan with sp_query_store_force_plan (find a prior good plan_id via sys.query_store_plan for query_id ${qs.queryId} in SSMS's Query Store UI). Lasting fix: update statistics on the tables it touches, or add/rebuild whatever index the new plan is missing.`,
    });
  }

```

- [ ] **Step 2: Add the tab mapping**

In `client/src/components/DiagnosisSummary.tsx`, change:

```typescript
const PANEL_TO_TAB: Record<string, DashboardTab> = {
  Blocking: "blocking",
  "Long-running operation": "longops",
  "Agent job": "agentjobs",
  "CPU pressure": "overview",
  "Memory pressure": "overview",
  "Worker threads": "overview",
  "Plan cache": "overview",
  TempDB: "overview",
  "Transaction log": "logspace",
  "VLF count": "logspace",
  "Disk latency": "iolatency",
  "Disk space": "overview",
  Autogrowth: "autogrowth",
  Deadlocks: "deadlocks",
};
```

to:

```typescript
const PANEL_TO_TAB: Record<string, DashboardTab> = {
  Blocking: "blocking",
  "Long-running operation": "longops",
  "Agent job": "agentjobs",
  "CPU pressure": "overview",
  "Memory pressure": "overview",
  "Worker threads": "overview",
  "Plan cache": "overview",
  TempDB: "overview",
  "Transaction log": "logspace",
  "VLF count": "logspace",
  "Disk latency": "iolatency",
  "Disk space": "overview",
  Autogrowth: "autogrowth",
  Deadlocks: "deadlocks",
  "Query Store": "querystore",
};
```

- [ ] **Step 3: Update the quick-refresh caveat note**

In `client/src/components/DiagnosisSummary.tsx`, change:

```tsx
      Based on a quick check only — TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, and Volume Space weren't checked this time.
```

to:

```tsx
      Based on a quick check only — TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, and Query Store weren't checked this time.
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/diagnosis.ts client/src/components/DiagnosisSummary.tsx
git commit -m "Add diagnosis finding and jump link for Query Store regressions"
```

---

### Task 9: `summary.ts` — Copy for AI section

**Files:**
- Modify: `client/src/summary.ts`

- [ ] **Step 1: Add the cap constant**

Change:

```typescript
const MAX_QUERY_CHARS = 200;
const MAX_CONSUMERS_SHOWN = 25;
const MAX_BLOCKED_SHOWN = 15;
const MAX_DEADLOCKS_SHOWN = 3;
```

to:

```typescript
const MAX_QUERY_CHARS = 200;
const MAX_CONSUMERS_SHOWN = 25;
const MAX_BLOCKED_SHOWN = 15;
const MAX_DEADLOCKS_SHOWN = 3;
const MAX_QUERY_STORE_SHOWN = 15;
```

- [ ] **Step 2: Add the section**

Insert this right after the "Recent Deadlocks" section (after the `lines.push("");` that follows it, i.e. after line 280, before the "Top Tables by Scans" section):

```typescript
  lines.push("## Query Store Regressions (queries ≥3x slower than their own recent average; last 24h; Query Store-enabled databases only)");
  if (data.queryStoreRegressions === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.queryStoreRegressions.length === 0) {
    lines.push("No regressed queries found in any Query Store-enabled database.");
  } else {
    const shown = data.queryStoreRegressions.slice(0, MAX_QUERY_STORE_SHOWN);
    for (const qs of shown) {
      lines.push(
        `- ${qs.databaseName} (query_id ${qs.queryId}): ${qs.regressionRatio.toFixed(1)}x slower — recent avg ${qs.recentAvgDurationMs.toFixed(
          0
        )}ms vs. prior avg ${qs.priorAvgDurationMs.toFixed(0)}ms, ${qs.executionCount} execution(s) — ${truncate(qs.queryText, MAX_QUERY_CHARS)}`
      );
    }
    if (data.queryStoreRegressions.length > shown.length) {
      lines.push(`... and ${data.queryStoreRegressions.length - shown.length} more not shown here - see the Query Store tab.`);
    }
  }
  lines.push("");

```

- [ ] **Step 3: Add `truncate` to the existing import**

`summary.ts` already imports `truncate` (line 3: `import { formatMs, truncate } from "./format";`) — no change needed here, just confirm it's already there.

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/summary.ts
git commit -m "Add Query Store Regressions section to Copy for AI"
```

---

### Task 10: Verify Phase 1 end-to-end

**Files:**
- Create (scratch, not committed): `/tmp/claude-0/-home-user-SQLMonitoring/26ab8cad-a5c3-5329-a469-199a2e9dfdec/scratchpad/mock-server.js`

- [ ] **Step 1: Write a mock server serving canned `TriageData` JSON**

```javascript
// Scratch verification server - not part of the app, not committed. Serves canned JSON matching
// TriageData so the built client can be exercised in a browser without a real SQL Server.
const express = require("express");
const app = express();
app.use(express.json());

const connection = { server: "mock", database: "master", loginName: "MOCK\\dba", odbcDriver: "ODBC Driver 18 for SQL Server" };

const emptyTriage = {
  overview: { cpuCount: 8, sqlServerStartTime: new Date().toISOString(), activeSessionCount: 5, activeRequestCount: 1, blockedRequestCount: 0, bufferCacheHitRatio: 99.2, pageLifeExpectancy: 5000, batchRequestsPerSec: 120, planCacheMb: 200, adhocPlanCacheMb: 10, adhocPlanCachePercent: 5, singleUseAdhocPlanCount: 3, singleUseAdhocPlanMb: 10 },
  blocking: [], longOps: [], agentJobs: [], waits: [],
  pressure: { signalWaitPercent: 2, pageLifeExpectancy: 5000, bufferCacheHitRatio: 99.2, pendingMemoryGrants: 0, runnableTasksCount: 0, workQueueCount: 0 },
  logSpace: [], consumers: [],
  tempdb: { totalDataFileMb: 1000, usedMb: 100, freeMb: 900, userObjectsMb: 50, internalObjectsMb: 40, versionStoreMb: 10, topAllocators: [] },
  vlfCounts: [], ioLatency: [], autogrowth: [], deadlocks: [], volumeSpace: [],
  queryStoreRegressions: [],
};

const populatedTriage = {
  ...emptyTriage,
  queryStoreRegressions: [
    { databaseName: "AppDb", queryId: 4242, queryText: "SELECT * FROM Orders WHERE CustomerId = @p1 AND Status = @p2", recentAvgDurationMs: 8200, priorAvgDurationMs: 900, recentAvgCpuMs: 7800, priorAvgCpuMs: 850, regressionRatio: 9.1, executionCount: 340 },
  ],
};

let mode = "empty";
app.get("/api/connection/status", (req, res) => res.json({ connected: true, connection }));
app.get("/api/triage", (req, res) => {
  const data = mode === "populated" ? populatedTriage : emptyTriage;
  res.setHeader("Content-Type", "application/x-ndjson");
  res.write(JSON.stringify({ type: "done", data }) + "\n");
  res.end();
});
app.get("/api/triage/panel/:tab", (req, res) => res.json({}));
app.post("/toggle", (req, res) => { mode = mode === "empty" ? "populated" : "empty"; res.json({ mode }); });
app.use(express.static("client/dist"));
app.listen(4000, () => console.log("mock server on :4000, mode=empty (POST /toggle to switch)"));
```

- [ ] **Step 2: Run it against the built client**

```bash
cd /home/user/SQLMonitoring && node /tmp/claude-0/-home-user-SQLMonitoring/26ab8cad-a5c3-5329-a469-199a2e9dfdec/scratchpad/mock-server.js &
sleep 1
curl -s http://localhost:4000/api/connection/status
```

Expected: `{"connected":true,"connection":{...}}` — server is up.

- [ ] **Step 3: Check the not-checked state with Playwright**

Load `http://localhost:4000`, click the **Query Store** tab. Expected: the tab shows a dim-gray dot (not checked yet — this is a Quick-only initial load) and the panel renders `NotCheckedPanel`'s "Not checked in this quick refresh — click Full Refresh to check this." text.

- [ ] **Step 4: Check the populated state**

Run `curl -s -X POST http://localhost:4000/toggle` to flip the mock to `populated`, click **Full Refresh** in the browser, then the **Query Store** tab. Expected: one row for `AppDb` / query_id 4242, ratio "9.1x", and the diagnosis banner on the Overview tab shows a critical finding mentioning Query Store (since ratio ≥ 5 and recent avg ≥ 5000ms).

- [ ] **Step 5: Stop the mock server**

```bash
kill %1
```

- [ ] **Step 6: No commit** — this step produces no repo changes; the mock server file lives only in the scratchpad directory.

---

## Phase 2: Error Log

### Task 11: Server query module — `errorLog.ts`

**Files:**
- Create: `server/src/sql/errorLog.ts`

**Interfaces:**
- Consumes: `getPool()` from `server/src/db.ts`.
- Produces: `export interface ErrorLogEntry { timestamp: string; severity: number | null; message: string; }` and `export async function getRecentErrorLogEntries(): Promise<ErrorLogEntry[]>` — consumed by Task 12 (`dashboard.ts`).

- [ ] **Step 1: Write the module**

```typescript
import { getPool } from "../db";

export interface ErrorLogEntry {
  timestamp: string;
  severity: number | null;
  message: string;
}

interface RawErrorLogRow {
  log_date: string;
  text: string;
}

const SEVERITY_PATTERN = /Severity:\s*(\d+)/i;

// xp_readerrorlog only AND's its two optional search-string filters together, which can't
// express "any of these several patterns" (corruption codes, out-of-memory, etc.) - simpler and
// more complete to pull the whole 24h window unfiltered and filter here. Severity alone (not a
// separate list of error-number patterns) catches what's worth surfacing: 823/824/825
// (corruption) are Severity 24/25, out-of-memory (701/17803) is Severity 17/20 - every "real
// failure, not routine noise" line in the log carries a Severity >= 16.
function parseSeverity(text: string): number | null {
  const match = SEVERITY_PATTERN.exec(text);
  return match ? Number(match[1]) : null;
}

// Reads the last 24 hours of SQL Server's own error log (current log file only - a log that
// recycled very recently, e.g. right after a restart, could have older entries in Errorlog.1
// this doesn't follow; a documented trade-off, not an oversight, matching how indexStats.ts
// documents its own index-name-resolution trade-off). Wrapped in try/catch: xp_readerrorlog can
// be restricted by policy, same as the trace/XE reads in autogrowth.ts/deadlocks.ts.
export async function getRecentErrorLogEntries(): Promise<ErrorLogEntry[]> {
  const pool = getPool();

  try {
    const result = await pool.request().query(`
      CREATE TABLE #errorlog (LogDate DATETIME, ProcessInfo NVARCHAR(50), Text NVARCHAR(MAX));
      INSERT INTO #errorlog (LogDate, ProcessInfo, Text)
      EXEC xp_readerrorlog 0, 1, NULL, NULL, DATEADD(HOUR, -24, GETDATE()), NULL;
      SELECT TOP 200 CONVERT(varchar(33), LogDate, 126) AS log_date, Text AS text
      FROM #errorlog
      ORDER BY LogDate DESC;
      DROP TABLE #errorlog;
    `);

    return (result.recordset as RawErrorLogRow[])
      .map((row) => ({ timestamp: row.log_date, severity: parseSeverity(row.text), message: row.text.trim() }))
      .filter((row) => row.severity !== null && row.severity >= 16)
      .slice(0, 50);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/src/sql/errorLog.ts
git commit -m "Add SQL Server error log reader (severity 16+, last 24h)"
```

---

### Task 12: Wire into `dashboard.ts`

**Files:**
- Modify: `server/src/routes/dashboard.ts`

- [ ] **Step 1: Add the import**

Add after the `import { getQueryStoreRegressions } from "../sql/queryStoreRegressions";` line added in Task 2:

```typescript
import { getRecentErrorLogEntries } from "../sql/errorLog";
```

- [ ] **Step 2: Add it to the full-only `Promise.all` batch**

Change:

```typescript
    const [tempdb, vlfCounts, ioLatency, autogrowth, deadlocks, volumeSpace, queryStoreRegressions] = await Promise.all([
      tracked(emit, "tempdb", getTempdbStats()),
      tracked(emit, "vlfCounts", getVlfCounts()),
      tracked(emit, "ioLatency", getIoLatency()),
      tracked(emit, "autogrowth", getRecentAutogrowthEvents()),
      tracked(emit, "deadlocks", getRecentDeadlocks()),
      tracked(emit, "volumeSpace", getVolumeSpace()),
      tracked(emit, "queryStoreRegressions", getQueryStoreRegressions()),
    ]);
```

to:

```typescript
    const [tempdb, vlfCounts, ioLatency, autogrowth, deadlocks, volumeSpace, queryStoreRegressions, errorLogEntries] = await Promise.all([
      tracked(emit, "tempdb", getTempdbStats()),
      tracked(emit, "vlfCounts", getVlfCounts()),
      tracked(emit, "ioLatency", getIoLatency()),
      tracked(emit, "autogrowth", getRecentAutogrowthEvents()),
      tracked(emit, "deadlocks", getRecentDeadlocks()),
      tracked(emit, "volumeSpace", getVolumeSpace()),
      tracked(emit, "queryStoreRegressions", getQueryStoreRegressions()),
      tracked(emit, "errorLogEntries", getRecentErrorLogEntries()),
    ]);
```

- [ ] **Step 3: Add it to the `done` payload**

Change:

```typescript
        volumeSpace,
        queryStoreRegressions,
      },
    });
```

to:

```typescript
        volumeSpace,
        queryStoreRegressions,
        errorLogEntries,
      },
    });
```

- [ ] **Step 4: Add the per-tab fetcher**

In `PANEL_FETCHERS`, add after the `querystore` entry from Task 2:

```typescript
  errorlog: async () => ({ errorLogEntries: await labeled("errorLogEntries", getRecentErrorLogEntries()) }),
```

- [ ] **Step 5: Typecheck**

Run: `cd server && npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/dashboard.ts
git commit -m "Wire Error Log into the Full Refresh batch and per-tab fetch"
```

---

### Task 13: Client types — `types.ts`

**Files:**
- Modify: `client/src/types.ts`

- [ ] **Step 1: Add the `ErrorLogEntry` interface**

Add after the `QueryStoreRegression` interface (added in Task 3):

```typescript
export interface ErrorLogEntry {
  timestamp: string;
  severity: number | null;
  message: string;
}
```

- [ ] **Step 2: Add `"errorlog"` to `DashboardTab`**

Change:

```typescript
  | "deadlocks"
  | "querystore"
  | "indexes";
```

to:

```typescript
  | "deadlocks"
  | "querystore"
  | "errorlog"
  | "indexes";
```

- [ ] **Step 3: Add the optional field to `TriageData`**

Change:

```typescript
  queryStoreRegressions?: QueryStoreRegression[];
  indexStats?: IndexStats;
}
```

to:

```typescript
  queryStoreRegressions?: QueryStoreRegression[];
  errorLogEntries?: ErrorLogEntry[];
  indexStats?: IndexStats;
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/types.ts
git commit -m "Add ErrorLogEntry type and errorlog tab key"
```

---

### Task 14: `useTriage.ts` — register as full-only panel

**Files:**
- Modify: `client/src/hooks/useTriage.ts`

- [ ] **Step 1: Add to `FULL_ONLY_PANELS`**

Change:

```typescript
const FULL_ONLY_PANELS = ["tempdb", "vlfCounts", "ioLatency", "autogrowth", "deadlocks", "volumeSpace", "queryStoreRegressions"];
```

to:

```typescript
const FULL_ONLY_PANELS = ["tempdb", "vlfCounts", "ioLatency", "autogrowth", "deadlocks", "volumeSpace", "queryStoreRegressions", "errorLogEntries"];
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useTriage.ts
git commit -m "Track Error Log in the Full Refresh progress checklist"
```

---

### Task 15: `RefreshProgress.tsx` — panel label

**Files:**
- Modify: `client/src/components/RefreshProgress.tsx`

- [ ] **Step 1: Add the label**

Change:

```typescript
  queryStoreRegressions: "Query Store",
  indexStats: "Indexes",
};
```

to:

```typescript
  queryStoreRegressions: "Query Store",
  errorLogEntries: "Error Log",
  indexStats: "Indexes",
};
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/RefreshProgress.tsx
git commit -m "Add Error Log label to the refresh progress checklist"
```

---

### Task 16: `ErrorLogPanel.tsx` component

**Files:**
- Create: `client/src/components/ErrorLogPanel.tsx`

**Interfaces:**
- Consumes: `Section` from `./Section`, `truncate` from `../format`, `ErrorLogEntry` from `../types`.
- Produces: `export function ErrorLogPanel({ errorLogEntries }: { errorLogEntries: ErrorLogEntry[] })` — consumed by Task 17 (`App.tsx`).

- [ ] **Step 1: Write the component**

```tsx
import { Section } from "./Section";
import { truncate } from "../format";
import type { ErrorLogEntry } from "../types";

export function ErrorLogPanel({ errorLogEntries }: { errorLogEntries: ErrorLogEntry[] }) {
  return (
    <Section
      id="panel-errorlog"
      title="Error Log"
      badge={<span className="panel-hint">severity 16+ only · last 24 hours · current log file</span>}
      isEmpty={errorLogEntries.length === 0}
      emptyText="No severity 16+ entries in the error log in the last 24 hours."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th className="num">Severity</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {errorLogEntries.map((row, idx) => (
              <tr key={idx}>
                <td>{new Date(row.timestamp).toLocaleString()}</td>
                <td className="num">{row.severity ?? "-"}</td>
                <td title={row.message}>{truncate(row.message, 160)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ErrorLogPanel.tsx
git commit -m "Add Error Log panel component"
```

---

### Task 17: Wire the tab into `App.tsx`

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Import the component**

Add after `import { QueryStorePanel } from "./components/QueryStorePanel";` (added in Task 7):

```typescript
import { ErrorLogPanel } from "./components/ErrorLogPanel";
```

- [ ] **Step 2: Add the tab entry in `buildTabs()`**

Insert right after the `querystore` entry added in Task 7, before the `indexes` entry:

```typescript
    {
      key: "errorlog",
      label: "Error Log",
      hasData: data.errorLogEntries ? data.errorLogEntries.length > 0 : undefined,
      node: data.errorLogEntries ? (
        <ErrorLogPanel errorLogEntries={data.errorLogEntries} />
      ) : (
        <NotCheckedPanel label="Error Log" />
      ),
    },
```

- [ ] **Step 3: Update the Full Refresh button's tooltip**

Change:

```tsx
            title="Adds heavier checks: TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, Query Store. Indexes isn't included — it's slow on servers with many databases; refresh it from its own tab."
```

to:

```tsx
            title="Adds heavier checks: TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, Query Store, Error Log. Indexes isn't included — it's slow on servers with many databases; refresh it from its own tab."
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "Add Error Log tab to the dashboard"
```

---

### Task 18: `diagnosis.ts` finding + `DiagnosisSummary.tsx` jump link

**Files:**
- Modify: `client/src/diagnosis.ts`
- Modify: `client/src/components/DiagnosisSummary.tsx`

- [ ] **Step 1: Import `truncate`**

Change:

```typescript
import type { TriageData } from "./types";
import { formatMs } from "./format";
```

to:

```typescript
import type { TriageData } from "./types";
import { formatMs, truncate } from "./format";
```

- [ ] **Step 2: Add the finding**

Insert right after the Query Store regression loop added in Task 8 (before `return findings.sort(...)`):

```typescript
  if (data.errorLogEntries && data.errorLogEntries.length > 0) {
    const worst = data.errorLogEntries.reduce((a, b) => ((b.severity ?? 0) > (a.severity ?? 0) ? b : a));
    findings.push({
      severity: (worst.severity ?? 0) >= 20 ? "critical" : "warning",
      panel: "Error Log",
      title: `${data.errorLogEntries.length} severity 16+ error log entr${data.errorLogEntries.length === 1 ? "y" : "ies"} in the last 24 hours`,
      detail: `Worst: severity ${worst.severity ?? "-"} at ${new Date(worst.timestamp).toLocaleTimeString()} — ${truncate(worst.message, 160)}`,
      advice:
        (worst.severity ?? 0) >= 24
          ? "Severity 24-25 means a corruption error (823/824/825) — stop and run DBCC CHECKDB on the affected database immediately; don't take new backups over a known-good one until you know the extent of the damage. Open the Error Log tab for the full message."
          : "Open the Error Log tab for the full text of every entry. Severity 20+ is a fatal error to that connection/process (check for out-of-memory - 701/17803); severity 16-19 is a normal but real error worth understanding, not routine noise.",
    });
  }

```

- [ ] **Step 3: Add the tab mapping**

In `client/src/components/DiagnosisSummary.tsx`, change:

```typescript
  "Query Store": "querystore",
};
```

to:

```typescript
  "Query Store": "querystore",
  "Error Log": "errorlog",
};
```

- [ ] **Step 4: Update the quick-refresh caveat note**

Change:

```tsx
      Based on a quick check only — TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, and Query Store weren't checked this time.
```

to:

```tsx
      Based on a quick check only — TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, Query Store, and Error Log weren't checked this time.
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/diagnosis.ts client/src/components/DiagnosisSummary.tsx
git commit -m "Add diagnosis finding and jump link for Error Log"
```

---

### Task 19: `summary.ts` — Copy for AI section

**Files:**
- Modify: `client/src/summary.ts`

- [ ] **Step 1: Add the cap constant**

Change:

```typescript
const MAX_QUERY_STORE_SHOWN = 15;
```

to:

```typescript
const MAX_QUERY_STORE_SHOWN = 15;
const MAX_ERROR_LOG_SHOWN = 20;
```

- [ ] **Step 2: Add the section**

Insert right after the Query Store Regressions section added in Task 9 (after its trailing `lines.push("");`, before "## Top Tables by Scans"):

```typescript
  lines.push("## Error Log (severity 16+ only; last 24 hours; current log file)");
  if (data.errorLogEntries === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.errorLogEntries.length === 0) {
    lines.push("No severity 16+ entries in the last 24 hours.");
  } else {
    const shown = data.errorLogEntries.slice(0, MAX_ERROR_LOG_SHOWN);
    for (const e of shown) {
      lines.push(`- ${new Date(e.timestamp).toLocaleString()} (severity ${e.severity ?? "-"}): ${truncate(e.message, MAX_QUERY_CHARS)}`);
    }
    if (data.errorLogEntries.length > shown.length) {
      lines.push(`... and ${data.errorLogEntries.length - shown.length} more not shown here - see the Error Log tab.`);
    }
  }
  lines.push("");

```

- [ ] **Step 3: Typecheck**

Run: `cd client && npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/summary.ts
git commit -m "Add Error Log section to Copy for AI"
```

---

### Task 20: Verify Phase 2 end-to-end

**Files:**
- Modify (scratch, not committed): `/tmp/claude-0/-home-user-SQLMonitoring/26ab8cad-a5c3-5329-a469-199a2e9dfdec/scratchpad/mock-server.js`

- [ ] **Step 1: Extend the mock data**

In `emptyTriage`, add `errorLogEntries: []`. In `populatedTriage`, add:

```javascript
  errorLogEntries: [
    { timestamp: new Date().toISOString(), severity: 24, message: "Error: 824, Severity: 24, State: 2. SQL Server detected a logical consistency-based I/O error." },
  ],
```

- [ ] **Step 2: Re-run and check the not-checked state**

```bash
cd /home/user/SQLMonitoring && node /tmp/claude-0/-home-user-SQLMonitoring/26ab8cad-a5c3-5329-a469-199a2e9dfdec/scratchpad/mock-server.js &
sleep 1
```

Load `http://localhost:4000`, click the **Error Log** tab. Expected: dim-gray dot, `NotCheckedPanel`'s default "click Full Refresh" text.

- [ ] **Step 3: Check the populated state**

`curl -s -X POST http://localhost:4000/toggle`, click **Full Refresh**, then the **Error Log** tab. Expected: one row, severity 24, the 824 message (truncated with the full text in a hover tooltip). The Overview tab's diagnosis banner should show a critical finding (severity 24 ≥ 20) mentioning corruption/DBCC CHECKDB — check it doesn't get buried under the Query Store finding from Phase 1's fixture (both are critical; either can legitimately be "top," but both must appear either as the top finding or in "other potential factors").

- [ ] **Step 4: Check Copy for AI**

Click **Copy for AI**, paste the clipboard contents somewhere readable. Expected: `## Query Store Regressions` and `## Error Log` sections both present with the fixture data, in that order.

- [ ] **Step 5: Stop the mock server**

```bash
kill %1
```

- [ ] **Step 6: No commit** — scratch file only.

---

## Phase 3: Documentation

### Task 21: `CHANGELOG.md`, `README.md`, `CLAUDE.md`

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a new `CHANGELOG.md` heading**

Today (2026-07-16) is after the top-most existing heading (`## 1.5.0 — 2026-07-08`), so this starts a new version. Insert at the top of the file, right after the `# Version History` line (line 1):

```markdown

## 1.6.0 — 2026-07-16

### Added
- **Query Store Regressions tab**: a new full-only tab surfaces queries whose most recent
  Query Store interval is running at least 3x slower than that same query's own recent
  average (and at least 1 second, to keep trivial queries out of the noise) — the "it was
  fine yesterday" cause of slowness that nothing else in the app could see, since it's
  specific to one query's plan, not a resource or blocking problem. Loops over every
  database with Query Store enabled (`is_query_store_on = 1`); capped to the top 25
  regressions server-wide, sorted by how much worse they got. `diagnosis.ts` flags a
  regression as critical at 5x or a 5-second recent average, with advice to force the prior
  plan via `sp_query_store_force_plan` as an immediate mitigation.
- **Error Log tab**: a new full-only tab surfaces the last 24 hours of SQL Server's own
  error log, filtered to severity 16+ (corruption errors 823/824/825, out-of-memory,
  and other real failures) instead of the routine startup/backup/checkpoint lines that
  dominate a raw log — previously only visible by remoting into the server and opening the
  log file directly. Read via `xp_readerrorlog` against the current log file only.
  `diagnosis.ts` flags severity 24-25 (corruption) as critical with advice to run
  `DBCC CHECKDB` immediately.

```

- [ ] **Step 2: Update `README.md`'s Full Refresh description**

Change:

```markdown
**Full Refresh** additionally runs the heavier checks — Consumers,
TempDB, VLF Counts, IO Latency, Autogrowth, Deadlocks, Disk Volume Space,
Indexes.
```

to:

```markdown
**Full Refresh** additionally runs the heavier checks — Consumers,
TempDB, VLF Counts, IO Latency, Autogrowth, Deadlocks, Disk Volume Space,
Query Store Regressions, Error Log, Indexes.
```

- [ ] **Step 3: Update `README.md`'s tab strip list**

Change:

```markdown
Below that, a **tab strip** (pinned to the top while you scroll) switches
between Overview, Blocking, Consumers, Backups, Agent Jobs, Waits, Log
Space, IO Latency, Autogrowth, Deadlocks, and Indexes — only one tab's
content is shown at a time.
```

to:

```markdown
Below that, a **tab strip** (pinned to the top while you scroll) switches
between Overview, Blocking, Consumers, Backups, Agent Jobs, Waits, Log
Space, IO Latency, Autogrowth, Deadlocks, Query Store, Error Log, and
Indexes — only one tab's content is shown at a time.
```

- [ ] **Step 4: Add two bullets to `README.md`'s "What it shows" list**

Insert right after the "Recent Deadlocks" bullet, before the "Indexes" bullet:

```markdown
- **Query Store Regressions** — queries running at least 3x slower than their
  own recent average, in any database with Query Store enabled — catches a
  bad plan change even when nothing else looks wrong.
- **Error Log** — severity 16+ entries from the last 24 hours (corruption,
  out-of-memory, other real failures), filtered out of the routine noise a
  raw error log is mostly made of.
```

- [ ] **Step 5: Update `CLAUDE.md`'s `sql/*.ts` file list**

Change:

```markdown
- `sql/*.ts` — one file per diagnostic check (`overview`, `blocking`,
  `longOps`, `agentJobs`, `consumers`, `currentWaits`, `pressure`, `tempdb`,
  `logSpace`, `ioLatency`, `autogrowth`, `deadlocks`, `volumeSpace`,
  `indexStats`), each exporting a typed async function that runs against
  `getPool()`.
```

to:

```markdown
- `sql/*.ts` — one file per diagnostic check (`overview`, `blocking`,
  `longOps`, `agentJobs`, `consumers`, `currentWaits`, `pressure`, `tempdb`,
  `logSpace`, `ioLatency`, `autogrowth`, `deadlocks`, `volumeSpace`,
  `queryStoreRegressions`, `errorLog`, `indexStats`), each exporting a typed
  async function that runs against `getPool()`.
  - `queryStoreRegressions.ts` — Query Store is per-database, unlike every
    other DMV this app reads, so this loops over `sys.databases` where
    `is_query_store_on = 1` (bounded by database count, not row count —
    the same reasoning `indexStats.ts` used to justify *avoiding*
    per-database dynamic SQL for per-row lookups doesn't apply here, since
    this runs once per database, not once per row). Each database's query
    runs as a single `USE [db]; ...; USE [original]` batch so the
    connection's context is guaranteed restored before it goes back to the
    pool, regardless of which physical connection the pool handed it —
    splitting the USE and the query across separate `pool.request()` calls
    can't make that guarantee. A query counts as regressed against its own
    recent history (its last several Query Store intervals), not a fixed
    threshold, so a query that's always been slow doesn't fire and a fast
    query that got 3x slower does. Capped to the top 25 server-wide,
    unlike Consumers — Query Store history isn't naturally bounded by
    "currently executing."
  - `errorLog.ts` — reads the last 24h via `xp_readerrorlog` (current log
    file only), filtered in application code to severity 16+ rather than
    via `xp_readerrorlog`'s own search-string parameters, since those only
    AND two patterns together and can't express "any of several critical
    signatures." Severity alone already catches corruption (823/824/825 =
    severity 24/25) and out-of-memory (701/17803 = severity 17/20) without
    a separate pattern list.
```

- [ ] **Step 6: Update `CLAUDE.md`'s tab list mention**

Change:

```markdown
Everything else
(Overview+Pressure+TempDB+VolumeSpace together as the "Overview"
tab, then one tab each for Blocking, Consumers, Backups, Agent Jobs,
Waits, Log Space (+VLF counts), IO Latency, Autogrowth, Deadlocks,
Indexes) is tab-switched, not stacked on one
long page.
```

to:

```markdown
Everything else
(Overview+Pressure+TempDB+VolumeSpace together as the "Overview"
tab, then one tab each for Blocking, Consumers, Backups, Agent Jobs,
Waits, Log Space (+VLF counts), IO Latency, Autogrowth, Deadlocks,
Query Store, Error Log, Indexes) is tab-switched, not stacked on one
long page.
```

- [ ] **Step 7: Commit**

```bash
git add CHANGELOG.md README.md CLAUDE.md
git commit -m "Document Query Store Regressions and Error Log panels"
```

- [ ] **Step 8: Push the branch**

```bash
git push -u origin claude/session-start-dj1pfc
```

---

## Self-Review Notes

- **Spec coverage**: Both panels from the design doc are covered — Query Store scoping (all QS-enabled DBs, Task 1), regression definition (recent interval vs. own prior average, Task 1), Error Log 24h/severity filtering (Task 11), and all "shared wiring" bullets (`types.ts` Tasks 3/13, `dashboard.ts` Tasks 2/12, `useTriage.ts` Tasks 4/14, `RefreshProgress.tsx` Tasks 5/15, `App.tsx` tabs Tasks 7/17, `summary.ts` Tasks 9/19, `CHANGELOG.md` Task 21). `diagnosis.ts` findings (not explicitly itemized as a top-level spec bullet but required by the design's per-panel descriptions) are covered in Tasks 8/18.
- **Placeholder scan**: no TBD/TODO; every step has complete code, not a description of code.
- **Type consistency**: `QueryStoreRegression`/`ErrorLogEntry` field names match exactly between the server module (Tasks 1/11), `types.ts` (Tasks 3/13), and every component/summary/diagnosis consumer (Tasks 6/8/9/16/18/19) — checked `recentAvgDurationMs`, `priorAvgDurationMs`, `regressionRatio`, `queryId`, `queryText`, `executionCount` against every usage site; same for `timestamp`/`severity`/`message`.
- **Scope check**: two independent panels, each a self-contained phase producing a working, testable tab on its own — Phase 1 alone leaves the app in a shippable state before Phase 2 starts.
