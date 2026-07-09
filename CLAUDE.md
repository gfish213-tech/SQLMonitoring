# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SQL Performance Monitor — a live incident-triage tool for SQL Server: pick a
server, click Refresh, and see which of ~11 known causes of "the DB is slow"
is currently in play (blocking, a backup/long-op, an Agent job, CPU/memory
pressure, tempdb contention, a full log, disk latency, autogrowth, deadlocks).
It deliberately shows only *current* state, not trends — trend/daily
monitoring is handled by a separate tool (DBADash) the user already has. See
`README.md` for the full panel list and `INSTRUCTIONS.md` for setup/usage.

## Commands

Two independent npm projects under one thin root-level orchestration layer
(not a workspace — `server/` and `client/` each have their own
`node_modules`/lockfile).

`start.bat` (repo root) is the double-click entry point for end users who
don't want a terminal. Before doing anything else it checks Git, Node.js,
and npm are on `PATH` (`where`) and fails fast with a specific, named
message and a download link if any is missing — otherwise a missing tool
would only surface later as whatever raw, often cryptic error `npm`/
`node-gyp` happens to print, wrapped in a generic "install failed". It
also does a best-effort, non-fatal registry check
(`HKLM\SOFTWARE\ODBC\ODBCINST.INI\...`) for "ODBC Driver 17/18 for SQL
Server" and prints a warning (not a hard stop — this check can
false-negative, and the app's own Connect/Test Connection error is
already clear) if neither is found. It's self-bootstrapping: if it's
handed out as a standalone file (no `server/package.json` next to it), it
clones the repo into a `SQLMonitoring` subfolder first, then continues
from there — so sharing this one file is enough to get a new machine
running, provided Git, Node.js, the C++ build toolchain, and the ODBC
driver are already installed there (see Requirements below) and the
machine has access to clone the repo. If `npm install` itself fails (most
often a missing C++ build toolchain or Python — both required by
node-gyp to compile the native driver), the error message names that as
the likely cause rather than just pointing at the scrollback. Once inside
a real checkout, it force-syncs to whatever branch
is hardcoded as `BRANCH` in the script (currently
`claude/sql-performance-monitor-ui-tcteaq` — the branch all fixes are
pushed to), regardless of which branch happens to be checked out locally,
auto-stashing and restoring any local tracked edits (e.g. a user's own
additions to `server/config/servers.json`) around the switch/pull so
neither blocks on the other. Then best-effort runs `npm approve-scripts
msnodesqlv8` / `npm approve-scripts esbuild` in `server/` and `client/` as
a fallback for the `allowScripts` gate (see below) — this isn't a standard
npm subcommand, so failures here are silently ignored rather than aborting
the whole script — then `npm run install:all`, then `npm run
serve` in its own window, polls `localhost:4000` until the server
responds, and opens it in the default browser. **Update the `BRANCH`
value in `start.bat` if/when this work moves to a different branch (e.g.
after merging to main)** — keep it in sync with the npm scripts too if
those change (e.g. if the port or script names change).

```bash
# From repo root — the primary way this app is meant to be run
npm run install:all   # npm install in both server/ and client/
npm run build          # builds client, then server
npm start               # starts the server, which also serves the built client
npm run serve            # build + start in one shot

# Server (Express + TypeScript API + static file host, port 4000 by default)
cd server
npm run dev      # tsx watch, hot-reload — for active backend development only
npm run build    # tsc -> dist/
npm start        # run built dist/index.js

# Client (React + Vite + TypeScript)
cd client
npm run dev      # vite dev server on 5173, proxies /api to localhost:4000 — for active frontend development only
npm run build    # tsc -b && vite build -> dist/
```

There are no lint or test scripts configured in either project.

Some environments (e.g. a corporate npm policy) gate install scripts
behind an approval step — without it, `msnodesqlv8`'s `node-gyp rebuild`
install script never runs and the native driver never compiles, so
Connect/Test Connection fails later even though `npm install` itself
looked clean. `server/package.json` and `client/package.json` both commit
an `allowScripts` field (`{ "msnodesqlv8@5.2.1": true, "esbuild@0.28.1":
true }` and `{ "esbuild@0.25.12": true }` respectively) approving the
exact versions currently in use, so a fresh clone doesn't need any manual
approval step. Approval is per-package **and per-version** — if a
dependency bump changes the resolved version, the key goes stale and the
warning comes back; re-run `npm approve-scripts <pkg>` in the affected
folder and commit the updated `allowScripts` entry. (The
`--allow-scripts-pending` flag doesn't work for this — it only re-lists
pending scripts, it doesn't approve them.)

`server`'s `npm install` compiles the native `msnodesqlv8` driver via
node-gyp — this requires a C++ build toolchain and the Microsoft ODBC Driver
for SQL Server on the host, and in practice requires Windows (see
Authentication below). It will not build in a plain Linux/macOS dev sandbox
without unixODBC + the ODBC driver installed, and even then trusted-connection
auth needs the host to be domain-joined. **This means the server cannot be
boot-tested in most CI/sandbox environments** — verify server-side changes by
`tsc --noEmit`, code review, and a mock Express server serving canned JSON
(for exercising the client), rather than assuming `npm run dev`/`npm start`
will boot the real server. See the "Verifying changes" section below.

## Authentication

The app authenticates to SQL Server via **Windows Integrated Authentication
(trusted connection)** only — there is no username/password field or SQL
login path anywhere in the code. The connecting identity is always whichever
Windows account the Node server process runs as.

Every `connect()`/`testConnection()` call in `db.ts` runs
`IS_SRVROLEMEMBER('sysadmin')` right after opening the pool and throws
(closing the pool) if the result isn't `1`. This is a hard gate with no
lesser-privilege mode — don't add a bypass or a lower-privilege code path
without being asked; it's a deliberate security requirement, not a default
that happens to be strict.

## Connection string / ODBC driver handling

`mssql`'s own `msnodesqlv8` connection-string builder (inside the `mssql`
package itself) hardcodes the driver name to the deprecated "SQL Server
Native Client 11.0" on Windows and never wires up `TrustServerCertificate` at
all — both real gaps in the library, not something to route around lightly.
`db.ts` builds the connection string itself via `@tediousjs/connection-string`
and passes it through the `connectionString` config key (which
`mssql/lib/msnodesqlv8/connection-pool.js` uses verbatim, bypassing the
library's own builder entirely). It also probes installed ODBC drivers in
order (`ODBC Driver 18 for SQL Server` → `17` → `SQL Server Native Client
11.0`) using the raw `msnodesqlv8` promises API before opening the real pool,
and remembers whichever one worked (module-level `workingDriver` cache).

The native driver reports errors as plain objects (or arrays of them) shaped
`{ message, sqlstate, code }`, not `Error` instances — `mssql`'s own error
wrapping only preserves `.message` when the source `instanceof Error`, so a
plain-object error silently became `"[object Object]"` before this was fixed.
`extractDriverError()` in `db.ts` pulls the real text off whatever shape
comes back; don't reintroduce a bare `(err as Error).message` on errors from
this driver.

## Server list

There's no connection form — `server/config/servers.json` is a hardcoded,
user-edited list of servers (label, hostname, environment, optional
overrides for database/port/instanceName/encrypt/trustServerCertificate).
`server/src/serverList.ts` re-reads it from disk on every call (cheap, small
file) so edits take effect without a rebuild or restart. `routes/connection.ts`
only ever accepts a bare `server` hostname from the client and looks up the
rest from this config — the client never sends connection details other than
which server was picked.

## Refresh behavior

Deliberately **no default auto-refresh** — this tool is often used against a
server that's already struggling, so it must not add its own recurring query
load. `client/src/hooks/useTriage.ts` fetches once on mount and otherwise only
on an explicit `refresh()` call (the Refresh button) or when the user opts
into the `autoRefresh` toggle (20s interval). Don't add a default interval to
this hook or reintroduce per-panel polling — the whole design fetches
everything in one combined request (`GET /api/triage`) specifically to avoid
1 client generating 11 separate polling loops.

**Two refresh modes**, for the same reason taken further: `GET
/api/triage?mode=quick` (mount, the "Quick Refresh" button, and
auto-refresh — all three only ever request quick) runs just the small,
single-pass checks (bounded system DMVs, no per-row scans, no XML, no
disk/OS syscalls): overview, blocking, longOps, agentJobs, waits,
pressure, logSpace. `?mode=full` (or the query param omitted — the
"Full Refresh" button explicitly requests it) adds everything with a
larger scan surface: consumers, tempdb, vlfCounts, ioLatency, autogrowth,
deadlocks, volumeSpace, indexStats. `dashboard.ts`'s `router.get("/triage")`
runs the quick batch first (always), then conditionally the second batch
if not `mode=quick`; see `sql/*.ts` below for which specific DMV
characteristics put a check in which bucket. The full-only fields are
`undefined` (not present in the JSON at all) on a quick response —
`TriageData` marks them optional in `types.ts` for exactly this reason.
Every component reading a full-only field must treat `undefined` ("not
checked yet") as a third state distinct from an empty array ("checked,
nothing found") — see `NotCheckedPanel.tsx` and the `hasData: boolean |
undefined` tri-state on `App.tsx`'s tab dots (red/dim-gray/none). Adding a
new full-only check needs: the field marked optional in `types.ts`, a
guard in `diagnosis.ts` (`data.field ?? []` or an `if (data.field)`), a
"not checked" branch in `summary.ts`, and the tab wired with the
`hasData: undefined` / `<NotCheckedPanel>` pattern in `buildTabs()` —
skipping any one of these will crash or silently misreport on a
quick-only snapshot.

**Per-tab refresh**, one level below quick/full: `GET
/api/triage/panel/:tab` (the "↻ Refresh <Tab>" button always shown above
the active tab's content) re-runs only that tab's query — strictly less
load than even Quick Refresh, since it's one query (or two, for the
combined Overview and Log Space tabs) instead of seven-plus. `useTriage`'s
`refreshPanel(tab)` merges the returned partial object into the existing
`data` state rather than replacing it, so every other tab's data is
untouched, and tracks a per-tab `panelUpdatedAt` timestamp shown next to
the button separately from the global "Last updated" in the refresh bar.
This also doubles as a way to populate a single full-only tab (e.g.
Consumers) without paying for the rest of a Full Refresh. `PANEL_FETCHERS`
in `dashboard.ts` is the server-side map from tab key to fetcher(s) — it
must stay in sync with `DashboardTab` in `types.ts` and `buildTabs()` in
`App.tsx`; a new tab needs an entry in all three or its refresh button
404s.

**Live per-check progress**: `GET /api/triage` streams newline-delimited
JSON rather than returning one `res.json()` at the end — a Full Refresh
can take several seconds across many individually-costly checks
(Consumers, IO Latency, Autogrowth, Index Stats especially), and a single
opaque "Refreshing..." spinner can't tell a DBA whether it's almost done
or stuck on one specific slow check. Each query is wrapped in
`tracked()` (`dashboard.ts`), which writes a `{type:"progress", panel,
ok, ms}` line the instant that one query personally finishes —
independent of when the rest of its `Promise.all` phase finishes — and a
final `{type:"done", data:...}` line carries the same combined payload
this endpoint used to return in one shot (`{type:"error", message}` on
failure). This doesn't change what runs when or how many queries run
concurrently — it's the exact same two-phase `Promise.all` structure as
before, just observed from outside. `finish()`/the `ended` flag guard
against a real failure mode this introduced: `Promise.all` rejects as
soon as the *first* query in a batch fails, but the other queries in
that batch are still genuinely running server-side (rejecting the
combined promise doesn't cancel them) — without the guard, one of them
finishing after the `catch` block already `res.end()`'d would throw
trying to `res.write()` on a closed stream. `client/src/api.ts`'s
`triageStream()` reads the response via `res.body.getReader()`, buffering
until each `\n` and parsing one JSON object per line; `useTriage.ts`
seeds a `refreshChecks` list of pending panels for the current mode
before the first byte arrives (so the full checklist appears immediately,
not one item at a time as checks start) and flips each to done/error as
its progress line arrives. `RefreshProgress.tsx` renders these as small
pill chips under the refresh bar with a client-side 200ms ticker so a
still-pending chip's elapsed time visibly climbs — this is what actually
answers "which part is slow": watch the numbers, the one still climbing
after everything else has a checkmark is the bottleneck. Quick and Full
Refresh share this exact mechanism (same endpoint, mode-scoped panel
list); a new query added to either `Promise.all` batch needs its panel
key added to `QUICK_PANELS`/`FULL_ONLY_PANELS` in `useTriage.ts` and to
`PANEL_LABELS` in `RefreshProgress.tsx`, or it'll silently never appear
in the checklist.

## Architecture

### Server (`server/src`)

- `db.ts` — owns a single in-memory `ConnectionPool` (from
  `mssql/msnodesqlv8`, not plain `mssql`) for the whole process (module-level
  singleton, not per-request). `connect()`/`testConnection()` both go through
  `openVerifiedPool()`, which resolves the connection string (see above),
  opens the pool, runs the sysadmin check, and closes the pool again on any
  failure. `getPool()` throws if nothing is connected yet. No credentials are
  ever collected or stored — auth is entirely delegated to the OS identity.
- `serverList.ts` — reads/validates `config/servers.json` (see above).
- `types/mssql-msnodesqlv8.d.ts` — ambient module declaration aliasing
  `mssql/msnodesqlv8`'s types to the `mssql` package's types, since
  `@types/mssql` doesn't cover that driver subpath.
- `routes/connection.ts` — pool lifecycle endpoints (`servers`, `test`,
  connect, `status`, `disconnect`). Mounted at `/api/connection`. Enriches
  `ConnectionMeta` with `label`/`environment` from the matched
  `config/servers.json` entry before returning it to the client.
- `routes/dashboard.ts` — a single combined `GET /api/triage` endpoint that
  runs every `sql/*.ts` query via `Promise.all` (in two batches — quick then
  conditionally full, see Refresh behavior above) and returns one JSON
  object, plus `GET /api/triage/panel/:tab` (see "Per-tab refresh" above)
  which runs only the query/queries one tab owns via the `PANEL_FETCHERS`
  map. Mounted at `/api`, and applies a `requireConnection` middleware via
  `router.use()` with no path — this matches **every** request that
  reaches this router, unconditionally.
- `sql/*.ts` — one file per diagnostic check (`overview`, `blocking`,
  `longOps`, `agentJobs`, `consumers`, `currentWaits`, `pressure`, `tempdb`,
  `logSpace`, `ioLatency`, `autogrowth`, `deadlocks`, `volumeSpace`,
  `indexStats`), each exporting a typed async function that runs against
  `getPool()`. `statementText.ts` isn't a check itself — it's a shared SQL
  fragment (`CURRENT_STATEMENT_SELECT`) and formatter (`formatQueryText`)
  used by `consumers.ts`, `blocking.ts`, and `longOps.ts`, all three of
  which show "what query is this session running." `sys.dm_exec_sql_text`
  returns the *entire* batch or stored procedure body for a `sql_handle` —
  not just the statement actually executing — so naively selecting `qt.text`
  meant a session running inside even a modest stored procedure reported
  that procedure's whole (often hundreds-of-lines) source as its "query."
  `CURRENT_STATEMENT_SELECT` resolves the procedure name via `OBJECT_NAME
  (qt.objectid, qt.dbid)` when there is one, and `formatQueryText` prefers
  showing `EXEC dbo.ProcName` over the body; for ad-hoc SQL (no procedure)
  it falls back to `SUBSTRING`-ing out just the one statement at
  `[statement_start_offset, statement_end_offset)` — the standard
  "currently executing statement" idiom — instead of the whole
  (possibly multi-statement) batch text. `sys.dm_exec_connections.
  most_recent_sql_handle` (used for an idle blocker's last statement in
  `blocking.ts`, since an idle session has no active request to have
  offsets on) only gets the proc-name shortcut, not the offset slicing —
  there's no "currently executing" request to slice against.
  - `blocking.ts` — computes "lead blockers" (blockers not themselves
    waiting on anyone) in TypeScript from two queries, including blockers
    that are idle with an open transaction (`sys.dm_exec_sessions.status =
    'sleeping'` + `open_transaction_count > 0`) — a common, easy-to-miss
    blocking cause that a naive "who's blocking" query misses entirely.
    Each lead's `blockedSessions` is the full *transitive* chain (BFS over
    the waiter graph), not just direct waiters — in a chain A←B←C, C waits
    on B but A is still its root cause; each waiter carries `blockedBy` so
    the chain structure stays visible.
  - `currentWaits.ts` — `sys.dm_os_waiting_tasks` (instantaneous — what's
    waiting on something *right now*, unlike `sys.dm_os_wait_stats`'s
    cumulative-since-restart totals, which DBADash already covers).
    Excluding "benign" system waits by hand-listing wait type names
    doesn't scale — SQL Server has dozens of internal background wait
    types (Hekaton/XTP, HADR, full-text, Service Broker, checkpoint, lazy
    writer, etc.) and adds more every version; every one of them belongs
    to a SQL Server *system* worker task, not a user request, so the
    query joins `sys.dm_exec_sessions` and filters `is_user_process = 1`
    to exclude the whole category at once instead. The remaining
    name-based exclusions (`WAITFOR`, `%SLEEP%`, a few Service
    Broker/XE internals) are a second layer for waits a genuine *user*
    session can still generate that aren't diagnostically interesting —
    `WAITFOR` specifically because `overview.ts`/`pressure.ts`'s own
    1-second sampling shows up as a real (if meaningless) wait on this
    app's own connection otherwise. Grouped by `(session_id, wait_type)`
    (`COUNT(*)` as `taskCount`, `MAX(wait_duration_ms)` as the reported
    duration, `MIN(resource_description)` as one representative example) —
    `sys.dm_os_waiting_tasks` has one row per *task*, and a parallel query
    has one worker thread per degree of parallelism, so without this a
    single session running an 8-way parallel query shows up as 8+
    near-identical rows (same session, same wait type, differing only in
    an internal exchange/pipe id), burying every other session's waits.
    `WaitsPanel.tsx` shows the count in a "Tasks" column and appends
    "(+N more)" to the resource description when grouped; `summary.ts`
    notes it inline ("across N parallel tasks").
  - `overview.ts`, `pressure.ts` — "Batch Requests/sec", the buffer cache
    hit ratio, and signal wait % are all *cumulative-since-restart* sources
    (`PERF_COUNTER_BULK_COUNT` counters / `sys.dm_os_wait_stats`), so these
    two modules sample twice with a `WAITFOR DELAY '00:00:01'` between and
    report the 1-second delta — the raw values would show lifetime totals
    (billions of batches) or a lifetime average that can't move during a
    live incident. This means a refresh deliberately takes ~1 second; don't
    "optimize" the WAITFOR away, and exclude benign background waits (see
    `BENIGN_WAITS`, which must include `WAITFOR` itself) from any wait-stats
    delta. Page life expectancy is a true gauge and is read directly.
    `overview.ts` also reports plan cache size and the ad-hoc/single-use
    share from `sys.dm_exec_cached_plans` (plan cache pollution competes
    with the buffer pool for memory, directly relevant to PLE above);
    `pressure.ts` also reports `sys.dm_os_schedulers.runnable_tasks_count` /
    `work_queue_count` (true worker/scheduler exhaustion — distinct from,
    and doesn't need, the 1-second sampling the wait-time-based signal wait
    % does).
  - `agentJobs.ts` — matches a running job to its live session by computing
    the job_id-as-hex string *in SQL* (`CAST(job_id AS varbinary(16))`,
    style 2) and matching it against `sys.dm_exec_sessions.program_name`.
    Don't try to replicate SQL Server's GUID-to-hex byte ordering in
    JavaScript — it's a well-known source of subtle bugs.
  - `consumers.ts` — the "who's using the most CPU/memory/disk IO right
    now, with the actual query" panel. Reports both `logical_reads`
    (buffer-pool page touches, includes cache hits) and `sys.dm_exec_
    requests.reads` as `physicalReads` (real disk reads) side by side —
    logical alone can't distinguish "hot in cache" from "hammering the
    disk." Memory grant is an `OUTER APPLY` on `sys.dm_exec_query_memory_
    grants` keyed by `session_id`: most sessions never need one (no sort/
    hash/large join), so `memoryGrantMb` is `null` for most rows — that's
    normal, not a bug. `grant_time IS NULL` with a `requested_memory_kb`
    present means the session is queued waiting on a grant, not holding
    one; `memoryGrantPending` distinguishes the two states, and
    `memoryGrantMb` reports whichever figure (granted vs. requested) is
    relevant so the client always has one number to show. **No `TOP N` /
    row cap at all** — earlier versions used a flat `TOP N ORDER BY
    cpu_time`, then a `ROW_NUMBER()`-ranked union of per-metric top-N's,
    but both were solving a problem that doesn't actually need solving:
    `sys.dm_exec_requests` only has a row per request that's *currently
    executing* (idle/sleeping sessions never appear here), so it's already
    bounded by real concurrent work — in practice capped by CPU core count
    / `max worker threads`, not by total connections. Returning the whole
    result lets `ConsumersPanel.tsx` sort/filter client-side with zero risk
    of a genuine top IO or memory consumer being missing because it didn't
    make some server-side cutoff.
  - `tempdb.ts` — the used-space breakdown reads `tempdb.sys.dm_db_file_
    space_usage` (user/internal objects + version store), not `FILEPROPERTY`.
    `FILEPROPERTY(name, 'SpaceUsed')` evaluates against whatever database
    this connection is *currently* in (this app defaults to `master`), not
    the database implied by the table it's reading from — querying
    `tempdb.sys.database_files` for file names and then calling
    `FILEPROPERTY` on them silently returned `NULL` for every row (no file
    in `master` matches those names), which is why "Used" used to show
    `null MB`. `dm_db_file_space_usage` doesn't have this problem: it's
    genuinely queryable via a 3-part name from any database context. Its
    breakdown columns need SQL Server 2012+; wrapped in `.catch()` (all
    zeros) so older versions still return the rest of the panel.
  - `ioLatency.ts` — reports both the since-restart average (from
    `sys.dm_io_virtual_file_stats`, cumulative and therefore diluted by
    however long the server's been up) *and* a 1-second-delta "current"
    reading (same technique as `overview.ts`/`pressure.ts`: sample the DMV
    twice with a `WAITFOR DELAY '00:00:01'` between, using
    `num_of_bytes_read`/`written` from the same two samples for IOPS and
    MB/s throughput too). A file is surfaced if *either* figure crosses the
    15ms threshold — filtering on the average alone would hide a live spike
    that hasn't had time to move a lifetime average yet.
  - `volumeSpace.ts` — every distinct OS volume hosting a SQL Server file,
    via `sys.master_files CROSS APPLY sys.dm_os_volume_stats(...)`, so a
    drive running low on space shows up without remoting in to check
    Windows Explorer. Unlike `logSpace.ts`/`ioLatency.ts`, this one isn't
    thresholded down to "abnormal only" (see below) — it's rendered in the
    Overview tab, not a suspects tab, and every volume's headroom is useful
    context, not just the ones already critical.
  - `logSpace.ts` also exports `getVlfCounts()` — VLF (virtual log file)
    fragmentation is unrelated to how full a log currently is (a mostly-
    empty log can still be badly fragmented from past growth), so it's a
    separate check with its own >100-VLF threshold, not merged into the log
    fullness query. Requires `sys.dm_db_log_info` (SQL Server 2017+);
    wrapped in `.catch()` to an empty array on older versions.
  - `indexStats.ts` — `sys.dm_db_index_usage_stats` is server-wide (every
    database's stats from any connection, no per-database looping) and
    `OBJECT_NAME(object_id, database_id)` resolves table names cross-database
    the same way, so "Top Tables by Scans" needs nothing special. Index
    *names*, unlike table names, live in `sys.indexes` — a per-current-
    database catalog view — so resolving them across every other database
    on the server would need dynamic SQL executed once per database (the
    standard DBA-script pattern for this). This app deliberately doesn't do
    that for reliability across arbitrary server configurations; "Unused
    Indexes" shows `index_id` instead of a resolved name as a documented
    trade-off, not an oversight. Both queries reset on restart or index
    rebuild, same "since restart" caveat as `ioLatency.ts`'s average.
    `OBJECT_NAME(id, dbid)` against a non-current database is a genuinely
    slow per-row metadata lookup — both queries filter on plain numeric
    columns first (inside a derived table / `GROUP BY`+`HAVING`) and only
    resolve the name once per surviving row via `CROSS APPLY`, instead of
    calling it in the `WHERE` clause against every raw DMV row (which timed
    out in production on a server with many databases/objects before this
    was fixed). The whole function is also wrapped in `try`/`catch` →
    empty results, same reasoning as `autogrowth.ts`/`deadlocks.ts` below —
    a slow index scan on an unusually large server shouldn't take down the
    rest of a Full Refresh.
  - `autogrowth.ts`, `deadlocks.ts` — read from the default trace / the
    `system_health` extended-events session respectively, both of which are
    on by default but can be disabled by policy; both catch and return an
    empty array rather than erroring the whole `/api/triage` call.
  - Nothing here should return unfiltered *historical/cumulative* data
    (that's what DBADash is for): every panel is either instantaneous
    (`sys.dm_exec_requests`, `sys.dm_os_waiting_tasks`), a 1-second-delta
    "right now" reading, or explicitly thresholded down to "not normal"
    (e.g. `logSpace.ts` only returns databases over 50% log used). The one
    exception is `volumeSpace.ts`, which is current-state-but-unfiltered by
    design (see above) — that's a deliberate exception to the thresholding
    rule, not an oversight.
- `index.ts` — wires up the app, then serves the built client. **Route
  registration order matters**: `dashboardRouter` is mounted at the same
  `/api` prefix as other routes, and its unconditional `requireConnection`
  middleware will swallow *any* route registered after it under `/api` (this
  already broke `/api/health` once). A JSON 404 handler mounted at `/api`
  after both routers catches any unmatched API path — without it those fall
  through to the SPA catch-all and return `index.html` with a 200. Static
  file serving + the catch-all
  route for the client must come *after* all `/api/*` routes; it resolves
  `client/dist` via `path.resolve(__dirname, "../../client/dist")`, which
  works whether running from `server/src` (tsx dev) or `server/dist`
  (compiled) since both are two directories below the repo root.

### Client (`client/src`)

- `api.ts` — the single fetch client; every server call except `triage()`
  goes through the `request()` wrapper, which throws using the server's
  `{ error }` JSON body on non-2xx responses (and falls back to a generic
  message if `error` isn't a string, so a server-side bug can't surface as
  `[object Object]` again). `triage()` calls `triageStream()` instead —
  see "Live per-check progress" above — which handles the non-streaming
  error case (a non-2xx response, e.g. 409 "not connected," never reaches
  the stream at all since `requireConnection`'s middleware responds before
  the route handler runs) the same way `request()` does, then reads the
  200 case as a newline-delimited stream.
- `types.ts` — manually mirrors the server's response shapes (there's no
  shared types package between `client` and `server`); update both sides
  together when changing an API response shape.
- `hooks/useTriage.ts` — see Refresh behavior above. Exposes `refresh()`
  (quick) and `fullRefresh()` (full) as separate functions rather than a
  single `refresh(mode)` — this makes it impossible for a caller to
  accidentally wire the 20s auto-refresh interval to anything but quick.
  `lastMode` tracks which one the current `data` came from, for the
  "(quick check)" label next to the timestamp and the quick-only note in
  `DiagnosisSummary`. `refreshPanel(tab)` is the third, smallest refresh —
  see "Per-tab refresh" above — and merges its partial response into `data`
  with `setData(prev => prev ? { ...prev, ...partial } : prev)` rather than
  replacing it; `panelLoading`/`panelUpdatedAt` are tracked separately from
  the global `loading`/`lastUpdated` so a per-tab refresh doesn't disable
  the Quick/Full Refresh buttons or overwrite the main "Last updated" time.
- `diagnosis.ts` — `diagnose(data: TriageData): Finding[]`, pure heuristic
  scoring with no server round-trip (all the data it needs is already in the
  one combined `TriageData` payload). Each panel's data is checked against
  fixed thresholds (e.g. blocking wait time/count, signal wait % > 25/40,
  log/tempdb % full, I/O latency ms, volume free % < 15/5, VLF count >
  1000, ad-hoc plan cache % > 50 with > 256MB single-use) and turned into
  zero or more `Finding`s with a `severity` of `critical`/`warning`/`info`;
  results are sorted critical-first (stable sort, so ties keep panel-scan
  order: blocking, long ops, agent jobs, pressure/worker-threads/plan-cache,
  tempdb, log space/VLF count, I/O latency, disk space, autogrowth,
  deadlocks). `work_queue_count > 0` (SQL Server out of worker threads) is
  always critical and takes priority over `runnable_tasks_count > 0`
  (waiting for a free core) in the same refresh. The I/O latency finding
  checks the worse of the since-restart average and the 1-second-delta
  current reading, and says so ("Worse right now than its since-restart
  average...") when the current reading is what actually crossed the
  threshold. The reverse case matters just as much: if the *average* is
  what's driving severity but the current 1-second sample genuinely saw
  I/O and came back healthy (≤15ms), that average is almost certainly
  dragging on stale history from a since-fixed problem — the average has
  no way to recover except a server restart, so without this check a
  resolved issue would keep reading as an active critical finding
  indefinitely. This case downgrades to `info` and the title gets a
  "(currently healthy)" suffix rather than clearing the finding entirely
  (a single 1-second sample could still get lucky, so it stays visible,
  just de-prioritized). Adjust thresholds here, not in the component, if
  a panel's diagnosis reads as over/under-sensitive.
- `components/DiagnosisSummary.tsx` — renders the top `Finding` as a banner
  (color-coded by severity) at the top of the dashboard, with the rest in a
  collapsed `<details>` list; shows a plain "no obvious cause" state when
  `diagnose()` returns nothing rather than showing an empty banner. Every
  `Finding` carries a required `advice` string — a concrete first-response
  action, written for mid-incident use (what to kill and what never to
  kill, log backup vs. shrink, which tab to check next) — rendered as a
  "💡 What to do" box under the top finding. A new finding in `diagnosis.ts`
  must include advice; keep it action-first and warn about destructive
  options' consequences (e.g. KILL rolls back) rather than just naming the
  metric again. `summary.ts`'s Copy-for-AI text deliberately does *not*
  include `advice` (see below) — it's an on-screen-only field for a human
  skimming the dashboard. The expandable "N other potential factors" list
  groups *consecutive* findings that share the exact same `advice` string
  (`groupByAdvice`) into one shared "💡 What to do" box instead of repeating
  it once per finding — a real production snapshot can have a dozen+
  findings of the same kind (every VLF-fragmented database, every hot IO
  file, every autogrowth event) whose advice is a fixed template with no
  per-finding variation, and repeating that whole paragraph under each one
  was most of what made the list long to read. Only *consecutive* findings
  merge (not a global group-by) because `diagnose()`'s stable sort keeps
  same-severity findings from the same panel loop adjacent but never
  reorders across severity — two findings with identical advice text but
  different severity (e.g. one file's IO latency crossed the critical
  threshold, another only the warning one) correctly stay as separate,
  ungrouped items rather than being merged under one severity-blind box.
  Within a group, `detail` also collapses (`groupDetail`), two ways: if
  every member's `detail` is the literal same string (VLF count's is —
  it's pure boilerplate with zero per-database content), the whole thing
  shows once and each item shows just its `title`. Otherwise, since every
  `detail` in `diagnosis.ts` is built as `<unique part> — <fixed
  sentence>` (disk latency: file path — "normal is under ~15ms...";
  autogrowth: "Took Xms at HH:MM:SS" — "can cause a brief freeze..."),
  `splitCommonSuffix` checks whether the part *after* the first `" — "`
  is identical across the whole group; if so, that fixed sentence shows
  once and each item keeps just its own unique prefix (file path, or
  duration+time) — real per-finding data never collapses, only the
  fixed sentence attached to it. If neither condition holds (e.g. a mix
  of flagged/unflagged disk-latency findings in one group, whose trailing
  "Worse right now..." clause differs), `detail` falls back to showing
  in full per item rather than guessing wrong.
- `summary.ts` — `buildSummaryText(data, connection)` renders the whole
  snapshot (diagnosis + every panel) as plain text for the **Copy for AI**
  button in `App.tsx`'s refresh bar (`navigator.clipboard.writeText`, with a
  transient "Copied!" label). Deliberately spells everything out in full
  sentences rather than relying on visual layout (color, borders, table
  alignment) to carry meaning, since none of that survives being pasted into
  a chat. The Diagnosis section intentionally omits each `Finding`'s
  `advice` string (unlike the on-screen banner/list, which do show it) —
  this text is meant to be pasted into an actual AI chat, which can
  reason about the raw facts and formulate its own recommendation; echoing
  this app's own canned advice paragraph back at it, once per finding, is
  pure token waste on a real production snapshot with many similar
  findings (e.g. a dozen VLF-fragmented databases each repeating the
  identical DBCC SHRINKFILE paragraph) — don't reintroduce it here even
  though `Finding.advice` still exists and is still required for the
  on-screen component. Update this alongside `types.ts` when an API
  response shape changes, the same as the panel components. Since
  `consumers.ts` now
  returns every active request uncapped (see above), and deadlock XML can
  be individually huge, this text caps what it includes so a real
  production snapshot doesn't balloon into thousands of lines of
  mostly-redundant AI context: query text is truncated to `MAX_QUERY_CHARS`
  (200 — mainly a safety net now that `statementText.ts` already keeps
  query text down to one statement or a procedure name rather than a whole
  batch/proc body; still needed for a single ad-hoc statement that's
  itself huge, e.g. a giant multi-row `INSERT`), Consumers to the first
  `MAX_CONSUMERS_SHOWN` (25, already CPU-sorted from the server), blocked
  sessions per lead blocker to `MAX_BLOCKED_SHOWN` (15), and deadlock
  graphs to `MAX_DEADLOCKS_SHOWN` (3) — each cap adds a "... and N more,
  see the X tab" line rather than silently dropping data, since the
  on-screen tables themselves stay uncapped; this text is meant as
  AI-diagnostic
  context, not a full data dump.
- **Tabbed layout**: `App.tsx`'s `Dashboard` renders exactly one tab's
  content at a time via `activeTab` state (`DashboardTab` in `types.ts`) —
  the sticky toolbar is always visible, but `DiagnosisSummary` only renders
  on the Overview tab (`activeTab === "overview"`), not repeated on every
  tab switch — its "View details →" buttons still work from there to jump
  straight to the relevant tab, you just don't see the banner itself again
  once you've navigated away from Overview. Everything else
  (Overview+Pressure+TempDB+VolumeSpace together as the "Overview"
  tab, then one tab each for Blocking, Consumers, Backups, Agent Jobs,
  Waits, Log Space (+VLF counts), IO Latency, Autogrowth, Deadlocks,
  Indexes) is tab-switched, not stacked on one
  long page. `buildTabs(data)` is the single place that maps `TriageData`
  to tab definitions — add a new tab there (and to `DashboardTab` in
  `types.ts`) rather than hardcoding another panel into the JSX. Each tab
  carries a `hasData: boolean | undefined` tri-state (not a plain flag) that
  renders a red dot / no dot / dim gray dot on its `.tab-bar` button — `true`
  ("checked, found something"), `false` ("checked, clean"), or `undefined`
  ("not checked this refresh" — full-only tabs on a quick response), so a DBA
  can see which tabs have something to look at, which are already ruled out,
  and which simply haven't been checked yet, without clicking through all of
  them. Full-only tabs (Consumers, IO Latency, Autogrowth, Deadlocks,
  Indexes) and full-only sections within the Overview tab (TempDB, Disk
  Volume Space) render `NotCheckedPanel.tsx` — a dashed-border placeholder —
  instead of their normal panel when `hasData` is `undefined`, so "not
  checked" never gets misread as "checked, nothing found." This tri-state is
  what replaced the old sorted-by-emptiness 2-column layout when panels
  stopped being co-mounted.
  `DiagnosisSummary`'s `PANEL_TO_TAB` map turns a `Finding`'s `panel` label
  into a `DashboardTab` so its "View details →" button (passed down as
  `onJumpToPanel`) can switch straight to the relevant tab; a new
  `diagnosis.ts` panel label needs an entry here too, or that finding just
  won't get a jump button (harmless, but worth keeping in sync). Panel
  components still carry their old `panel-*` `id`s from the pre-tab
  jump-nav design; they're inert now (only one tab is ever mounted) but
  harmless to leave for test/automation selectors.
- **Explanatory hints**: `StatCard` takes an optional `hint` (rendered as a
  small "ⓘ" with a native `title` tooltip) for stats whose meaning isn't
  self-evident from the number alone (e.g. that Signal Wait % / Buffer
  Cache Hit Ratio are a 1-second sample, or that Version Store always reads
  0 pre-2016 SP2). `Section`'s `badge` prop is used the same way at the
  panel level for filtering/scope caveats that must stay visible whether or
  not the panel is empty (e.g. "top 20 by CPU time", "last 24 hours", "only
  databases over 50% log used") — the empty-state text alone only conveys
  this when the panel has nothing to show. `summary.ts` repeats the same
  caveats inline in each section's Markdown heading so they survive being
  pasted elsewhere. Any new panel with a non-obvious threshold, sample
  window, or row cap should follow the same pattern rather than leaving it
  to only the code comments.
- `components/ServerPicker.tsx` — the connect screen: a `<select>` populated
  from `GET /api/connection/servers`, with an environment badge, replacing
  what used to be a manual connection form. The list is sorted
  Development → Staging → Production (anything else, e.g. "No Longer
  Supported", sorts after Production), alphabetically by label within
  each group — `servers.json`'s own order is not the display order.
  Deliberately Dev-first: it's also what ends up pre-selected on load,
  so the default pick is the safest one, not whatever happened to be first
  in the config file — but that default is itself overridden by
  `localStorage` (`sql-monitor-last-server`, written on every successful
  `Connect`) if the last-connected server is still present in the current
  list, so a DBA who always monitors the same server doesn't have to
  reselect it every time the app loads.
- `components/ConsumersPanel.tsx` — client-side sort (click a column header
  to sort by it, click again to reverse; nulls always sort last regardless
  of direction) over whatever `consumers` rows the server sent — this is
  free re-ordering, not a new query, since `consumers.ts` returns every
  active request uncapped (see `sql/*.ts` above). Also
  has a client-only "Hide 'sa' session" checkbox (`loginName.toLowerCase()
  === "sa"`, case-insensitive) for filtering out a maintenance/monitoring
  login that clutters the list; defaults **on** (`sa` is almost always
  noise, not the cause) but stays a toggle, not a hard filter, since an
  incident genuinely caused by something running as `sa` is possible.
- `waitTypes.ts` — `describeWaitType(waitType)`, a client-side-only lookup
  (no server round-trip; the raw wait type string is already in every
  response) mapping a raw SQL Server wait type name to a plain-English
  explanation, since a name like `PAGEIOLATCH_SH` or `LCK_M_X` means
  nothing to anyone not already fluent in SQL Server internals. Exact
  matches for the wait types that actually surface in this app's own
  diagnosis thresholds and everyday incidents; a prefix table (`LCK_M_*`,
  `PAGEIOLATCH_*`/`PAGELATCH_*`, `PREEMPTIVE_*`, `HADR_*`, etc.) covers
  the rest of each wait "family" it doesn't have an exact entry for; a
  generic fallback note for anything still unrecognized rather than
  leaving it blank. Wired in as a native `title` tooltip (`.wait-type-cell`
  class — dotted-underline `cursor: help`, same visual language as
  `StatCard`'s `hint`) on every Wait Type column: `WaitsPanel.tsx`,
  `ConsumersPanel.tsx`, and `BlockingPanel.tsx`'s blocked-sessions table.
  Not exhaustive by design — there are hundreds of wait types — so add new
  entries here as specific ones come up rather than trying to cover all of
  them upfront.
- `components/Section.tsx` — shared wrapper for panels with an empty state;
  most panel components use it. `OverviewBar`, `PressurePanel`, and
  `TempdbPanel` render their own stat grids directly instead (no
  empty/populated distinction needed for always-present server vitals).
- `App.tsx` — top-level state machine: checks `/api/connection/status` on
  mount, then renders either `ServerPicker` or the `Dashboard` (all 11 panel
  components, driven by `useTriage`) once connected. The dashboard layout is
  three tiers, not one flat stack: (1) diagnosis banner + vitals (Overview,
  Pressure, TempDB) always full-width/fixed-position at the top; (2)
  Blocking and Consumers always full-width right below, since their tables
  are the widest and most information-dense; (3) the remaining 7 panels
  (LongOps, AgentJobs, Waits, LogSpace, IoLatency, Autogrowth, Deadlocks) are
  built as `{ empty, node }` pairs, sorted non-empty-first (stable sort, so
  ties keep their original relative order), and rendered into
  `.reference-grid` — a CSS multi-column flow (`column-count: 2`, `1` under
  900px), not a flexbox grid, so panels of very different heights pack
  without leaving big gaps. Keep new "reference" panels in that array/sort
  pattern rather than hardcoding them into the JSX, or the sort-to-top
  behavior silently stops applying to them.
- Styling is a single hand-written `styles.css` (no CSS framework/CSS-in-JS),
  built on a small set of CSS custom properties rather than hardcoded hex
  scattered through selectors: `--bg`/`--panel-bg`/`--control-bg` (surfaces),
  `--text`/`--text-dim`/`--text-muted` (ink), `--border`/`--gridline`,
  `--accent` (categorical identity color — never used for status), and a
  fixed status set (`--good`/`--warning`/`--serious`/`--danger`, each with a
  `--status-*-rgb` triplet for building `rgba(var(--status-critical-rgb),
  0.15)`-style tints without repeating hex). Dark values live in `:root`
  (this app's default appearance since it shipped); a `:root[data-theme="light"]`
  attribute-selector block overrides the surface/ink/accent variables for
  light — the status colors don't need a light override, since the same
  four hexes are validated against both surfaces. `theme.ts`'s `useTheme()`
  hook is the single place that sets `data-theme`: on first load it reads
  `localStorage` (`sql-monitor-theme`), falling back to
  `prefers-color-scheme` only if nothing's stored yet, then a `<ThemeToggle>`
  button (rendered once in `App.tsx`, fixed top-right on every screen —
  loading, `ServerPicker`, and `Dashboard`) flips it and persists the
  explicit choice. The attribute is applied in `useLayoutEffect`, not
  `useEffect`, specifically so a stored preference that differs from the
  OS default never flashes the wrong theme for one frame before repainting.
  `.app-header`, `.refresh-bar`, and `.tab-bar` all carry extra
  `padding-right` to keep their own right-aligned content (Switch Server,
  Last updated, wrapped tabs) clear of the fixed toggle button — widening
  the toggle or moving it needs a matching padding change in all three, or
  content will render underneath it. `--serious` is
  used only for the tab-bar "found something" dot, kept deliberately
  distinct from `--danger`/`--warning` so the tab strip never outshouts the
  diagnosis banner's own critical/warning coloring for the same finding.
  Numeric table columns use a `.num` class (`font-variant-numeric:
  tabular-nums; text-align: right`) so figures align vertically; stat-tile
  and hero values deliberately don't use it (proportional figures read
  better at display size — `tabular-nums` on a lone number like `121` looks
  loose). `th.num` mirrors the same right-alignment for the header cell
  above a `.num` column (and `.sortable-th.num .sort-button` for
  `ConsumersPanel.tsx`'s clickable headers) — every `<td className="num">`
  needs its column's `<th>` marked `.num` too, or the header label sits
  over the left edge of a column of right-aligned numbers, which reads as
  misaligned even though the numbers themselves line up correctly row to
  row. Don't reintroduce a raw hex inside a selector — add or reuse a
  custom property instead, or a themed screenshot silently stops updating
  with the other one.

## Verifying changes

Since the real server can't boot in most sandboxes (see Commands above),
verify UI/data-flow changes with a mock Express server on `:4000` serving
canned JSON matching the current `TriageData`/`ConnectionMeta`/
`ServerListEntry` shapes from `types.ts`, run the client's Vite dev server
against it, and check with Playwright/Chromium (`/opt/pw-browsers/chromium`
is preinstalled in this environment). Always verify both the empty state and
a populated state for any panel you touch — the empty-state text is a
first-class part of the product (a DBA needs "no blocking detected" to read
as confidently ruled-out, not "no data").

## Maintaining docs

When making a meaningful change (new feature, endpoint, DMV query, behavior
change, or bug fix worth noting), update these alongside the code — don't
leave them to drift:

- `CHANGELOG.md` — versioned by date, not by feature: every change lands
  under a `## X.Y.Z — YYYY-MM-DD` heading for the date it actually shipped,
  never under a bare `Unreleased` heading. Before adding an entry, check
  whether the top-most version heading is already dated today — if so,
  add the new bullet into that section's existing `### Added` / `### Fixed`
  / `### Changed` subsection (creating the subsection if today's version
  doesn't have one yet) rather than creating a second heading for the same
  day. Only start a new `## X.Y.Z — YYYY-MM-DD` heading (bumping the patch
  number, or minor for a larger change) when the date has actually rolled
  over since the last entry. This keeps one version per calendar day of
  work, however many separate changes landed that day, instead of an
  ever-growing `Unreleased` bucket or one version per commit.
- `README.md` — update if the feature list, stack, or high-level "what it
  shows" section is affected.
- `INSTRUCTIONS.md` — update if setup steps, commands, or user-facing usage
  changes.
- `CLAUDE.md` (this file) — update if the architecture, file responsibilities,
  or commands change.
