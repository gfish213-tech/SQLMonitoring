# Version History

## Unreleased

### Fixed
- **TempDB "Used" showed `null MB`**: the query read tempdb's file names
  from `tempdb.sys.database_files` but then called `FILEPROPERTY(name,
  'SpaceUsed')`, which evaluates against whatever database the connection
  is *currently* in (this app defaults to `master`), not the database
  implied by the table it's reading from — no file in `master` matched
  those names, so it silently returned `NULL` for every row. Replaced with
  `tempdb.sys.dm_db_file_space_usage`, which is genuinely queryable via a
  3-part name from any database, and which also gives a proper breakdown
  into **User Objects**, **Internal Objects**, and **Version Store**
  instead of one opaque "Used" number.

### Added
- **Current (1-second-delta) I/O latency, IOPS, and throughput** alongside
  the existing since-restart average in Disk / IO Latency: the average
  alone is diluted by however long the server's been up, so a file that
  started stalling minutes ago barely moves a lifetime average on a
  server that's been up for months. A file is now flagged if *either*
  figure is elevated, and the diagnosis banner says so explicitly when the
  current reading — not the average — is what crossed the threshold.
- **Disk Volume Space** panel (Overview tab): every OS volume hosting a
  SQL Server file, with free space/%, via `sys.dm_os_volume_stats` — no
  more remoting in to check Windows Explorer for free space. Flagged in
  the diagnosis banner under 15%/5% free.
- **Plan cache / ad-hoc query stats** (Overview tab): total plan cache
  size, the share that's ad-hoc (unparameterized SQL, as opposed to
  stored procs/`sp_executesql`), and single-use ad-hoc plan count/size —
  plan cache pollution competes with the buffer pool for memory and can
  drag down Page Life Expectancy. Flagged when ad-hoc share is over 50%
  and single-use plans exceed 256 MB.
- **Worker thread / scheduler exhaustion** (Overview tab, CPU & Memory
  Pressure): `runnable_tasks_count` (tasks ready to run but waiting for a
  free CPU core — true scheduler pressure, no sampling delay needed) and
  `work_queue_count` (SQL Server has run out of worker threads entirely —
  always a critical finding when non-zero) from `sys.dm_os_schedulers`.
- **VLF (virtual log file) counts** (Log Space tab): flags any database
  with over 100 VLFs via `sys.dm_db_log_info` (SQL Server 2017+) — a
  heavily fragmented log slows down recovery/failover and log-heavy
  writes, independently of how full the log currently is.
- **Index usage stats** (new Indexes tab): "Top Tables by Scans" (a high
  scan count relative to seeks can mean a missing index) and "Unused
  Indexes" (written to but never read — pure write overhead) from
  `sys.dm_db_index_usage_stats`. Shows `index_id` rather than a resolved
  index name — cross-database index name resolution needs per-database
  dynamic SQL, which this app avoids for reliability; table names still
  resolve correctly cross-database via `OBJECT_NAME(id, db_id)`.
- **Committed `allowScripts` approval** in `server/package.json` (for
  `msnodesqlv8@5.2.1` and `esbuild@0.28.1`) and `client/package.json` (for
  `esbuild@0.25.12`). Some environments (e.g. a corporate npm policy) gate
  install scripts behind an approval step; without it, `msnodesqlv8`'s
  `node-gyp rebuild` install script never runs, so the native SQL Server
  driver never compiles and every Connect/Test Connection attempt fails
  with "native msnodesqlv8 driver is not built on this host" even though
  `npm install` itself reported no errors. Committing the approval means a
  fresh clone doesn't need any manual step. `start.bat` also best-effort
  runs `npm approve-scripts msnodesqlv8` / `npm approve-scripts esbuild`
  before installing, as a fallback for when a dependency bump changes the
  resolved version and the committed approval goes stale. (An earlier
  attempt used `npm approve-scripts --allow-scripts-pending`, which just
  re-lists pending scripts instead of approving them — approval is
  per-package **and per-version** by name.)

### Fixed
- **"Batch Requests/sec" and "Buffer Cache Hit Ratio" showed lifetime
  totals, not current values**: both come from cumulative-since-restart
  performance counters, so on a real server "Batch Requests/sec" would have
  displayed the total number of batches ever executed (billions). Both are
  now computed as a 1-second delta (two samples with a `WAITFOR DELAY`
  between), so they show what the last second actually looked like. A
  refresh now deliberately takes about a second.
- **Signal Wait % (CPU pressure) was also cumulative since restart** — on a
  server up for months a live CPU storm barely moved it, and old history
  could keep it permanently elevated, making the diagnosis banner's "CPU
  pressure" finding unreliable in both directions. Now a 1-second delta
  over `sys.dm_os_wait_stats` with the standard benign background waits
  excluded.
- **Blocking chains dropped indirect victims**: in a chain A←B←C, session C
  (waiting on B, which waits on A) was silently omitted from A's blocked
  list, understating "blocking N sessions" during a real blocking storm.
  The full transitive chain is now collected, and a new "Waiting On" column
  shows each victim's direct blocker so the chain structure is visible.
- Top Resource Consumers is now capped at 20 rows (was unbounded — a server
  with hundreds of active requests would have rendered them all).
- Unknown `/api/*` paths now return a JSON 404 instead of falling through
  to the SPA catch-all and returning the app's HTML with a 200; the client's
  `request()` helper also no longer surfaces a raw `JSON.parse` error when a
  proxy or mid-restart server returns non-JSON.
- Diagnosis banner's CPU finding no longer reads "CPU pressure: CPU
  pressure: …".
- The Disk/IO Latency panel (and the corresponding section of the Copy for
  AI text) is now labeled "averaged since SQL Server restart" — that DMV is
  cumulative, and a 1-second sample would be too noisy for quiet files, so
  the caveat is stated instead of leaving the number to read as live.

### Added
- **Explanatory tooltips and panel badges** so a number or an empty panel
  isn't misread: a small "ⓘ" hint on stats whose meaning isn't obvious from
  the value alone (e.g. that Signal Wait % / Buffer Cache Hit Ratio /
  Batch Requests/sec are a 1-second sample; that TempDB Used includes the
  version store; that Version Store always reads 0 before 2016 SP2), and a
  persistent header badge on panels with a filtering rule that otherwise
  only shows up in the empty-state text (e.g. "top 20 by CPU time", "last
  24 hours", "excludes benign background waits", "only databases over 50%
  log used"). The Copy for AI text carries the same caveats inline in each
  section heading.
- **Tabbed layout** replaces the single long scrolling page: only the
  Diagnosis banner and the sticky Refresh bar/tab strip are always
  visible; everything else — Overview (with Pressure & TempDB), Blocking,
  Consumers, Backups, Agent Jobs, Waits, Log Space, IO Latency, Autogrowth,
  Deadlocks — is one tab each, shown one at a time. Every tab with actual
  data gets a small red dot so it's obvious at a glance which tabs are
  worth checking without clicking through all of them. The diagnosis
  banner's top finding (and each item in "N other potential factors") now
  has a **View details →** button that jumps straight to the relevant tab.
- `consumers.ts`'s per-session tempdb calculation had a paren mismatch that
  put the `* 8.0 / 1024` cast math inside `SUM(...)`'s own argument list,
  which made SQL Server parse it as a call to a nonexistent table function
  and fail with `'SUM' is not a recognized built-in function name`.
- `/api/triage` now labels each panel's query (e.g. `[consumers] ...`) on
  failure, so a bad query names itself instead of surfacing a bare,
  unattributed error.
- `start.bat`'s "stash local changes" step relied on `git diff --quiet HEAD`
  to predict whether anything needed stashing, which can false-positive on
  Windows (e.g. CRLF normalization) and lead to a `git stash push` that
  saves nothing, followed by a `git stash pop` that fails with "No stash
  entries found". It now checks whether a stash was actually created
  (comparing the stash ref before/after) instead of predicting it, and uses
  delayed expansion throughout so variables set inside a parenthesized
  block are read correctly.

### Added
- `start.bat` at the repo root: a double-click launcher for end users who
  don't want to touch a terminal. Force-syncs the local checkout to the
  branch all fixes are pushed to (fixing a "no tracking information for
  the current branch" failure when the local clone was sitting on
  `master`), auto-stashing and restoring any local tracked edits (like a
  user's own additions to `server/config/servers.json`) around the
  switch/pull, installs dependencies, runs `npm run serve` (build + start)
  in its own window, polls `localhost:4000` until the server responds, then
  opens it in the default browser automatically.
- `start.bat` is now self-bootstrapping: if handed to someone as a
  standalone file with no project next to it, it clones the repo into a
  `SQLMonitoring` subfolder first, then continues as normal — so sharing
  just this one file (plus the usual prerequisites: Git, Node.js, the C++
  build toolchain, and the ODBC driver) is enough to set up a new machine.
- **Diagnosis banner**: a summary at the top of the dashboard that scores
  all 12 panels against fixed thresholds and states the single most likely
  cause in plain language (e.g. "Most likely cause: Blocking — Session 82
  is blocking 2 other sessions"), with any other factors that crossed a
  threshold in a collapsed "N other potential factors" list, or a plain "no
  obvious cause detected" state if nothing did. Answers "which of the usual
  suspects is it" directly instead of requiring a manual scan of all 11
  panels.

### Changed
- **Dashboard re-layout** to cut down on scrolling and give panels with
  actual data more visual priority: vitals (Overview, Pressure, TempDB) stay
  compact and fixed at the top; Blocking and Consumers (the two widest,
  most information-dense tables) stay full-width right below; the
  remaining 7 reference panels (Backups, Agent Jobs, Waits, Log Space, I/O
  Latency, Autogrowth, Deadlocks) now flow into a 2-column layout sorted so
  panels with data float above the quiet "nothing to report" ones, instead
  of all 11 panels stacking full-width in a single fixed vertical order
  regardless of which ones actually have something to show.

### Added
- **Copy for AI** button in the refresh bar: copies the entire snapshot
  (diagnosis findings plus every panel's data, spelled out as plain text)
  to the clipboard in one click, ready to paste into an AI chat for a
  second opinion or help interpreting something unfamiliar.

## 1.2.0 — 2026-07-06

Reworked into a live incident-triage tool ("why is the DB slow right now?")
instead of a general trend dashboard — DBADash already covers daily/trend
monitoring, so this tool now only shows current state.

### Fixed
- `mssql`'s `msnodesqlv8` connection-string builder hardcoded the deprecated
  "SQL Server Native Client 11.0" ODBC driver on Windows and never wired up
  `TrustServerCertificate` at all. The app now builds its own ODBC connection
  string and probes installed drivers in order (18 → 17 → Native Client 11),
  remembering whichever one works.
- The native driver reports errors as plain objects (or arrays of them), not
  `Error` instances, which is why failures previously showed as
  `[object Object]`. Real diagnostic text (message + SQLSTATE) is now
  extracted and surfaced.

### Changed
- **Single-command run**: the Express server now serves the built React app
  as static files alongside the API on one port. A new root-level
  `package.json` adds `install:all`/`build`/`start`/`serve` so the whole app
  runs from one command instead of two separate dev servers.
- **Server picker replaces the connection form**: no more manual
  server/port/instance entry. `server/config/servers.json` holds a hardcoded,
  editable list of servers with environment labels (color-coded badge:
  Production/Staging/Development/deprecated); picking one and clicking
  Connect does the rest.
- **Manual refresh by default**: removed the always-on 5-10s polling. A
  single **Refresh** button re-fetches everything in one combined request;
  an explicit **Auto-refresh every 20s** checkbox opts into polling. This
  tool must not add its own query load to a server that may already be
  struggling.
- **Dashboard rebuilt around 11 specific causes of slowness** instead of
  general trend panels: Blocking & Long Transactions (now detects idle
  sessions holding open transactions, not just active blockers), Backups &
  Long-Running Operations, Running Agent Jobs, Top Resource Consumers (Right
  Now), Current Waits, CPU & Memory Pressure, TempDB Contention, Transaction
  Log Space, Disk/IO Latency, Recent Auto-Growth Events, Recent Deadlocks.
- Removed the cumulative-since-restart Top Queries, Wait Stats, and Active
  Sessions panels — that trend data is already covered by DBADash; this tool
  only shows what's happening right now.

## 1.1.0 — 2026-07-05

### Changed
- **Breaking**: switched from SQL Server login (username/password) to Windows
  Integrated Authentication (trusted connection), using the `msnodesqlv8`
  native driver instead of the pure-JS tedious driver. The server now
  connects to SQL Server as whichever Windows account the Node process runs
  as — there is no username/password anywhere in the app anymore.
- Added a hard access check: every `connect`/`test` call runs
  `IS_SRVROLEMEMBER('sysadmin')` immediately after connecting and rejects
  (closing the pool) if the connecting Windows account is not a `sysadmin`.
  There is no lesser-privilege mode.
- Connection form: removed Username/Password/Trust-server-certificate fields;
  added an optional Instance Name field for named instances.
- This requires the app to run on Windows (or Linux/macOS with unixODBC + the
  Microsoft ODBC Driver, though trusted-connection auth there depends on the
  host being domain-joined) with a C++ build toolchain, since `msnodesqlv8` is
  a native module compiled via node-gyp at `npm install` time.

## 1.0.0 — 2026-07-05

Initial release.

### Added
- Express/TypeScript API server connecting to SQL Server via the `mssql`
  package, with in-memory connection pool management (test / connect /
  status / disconnect).
- DMV-backed monitoring endpoints:
  - Server overview (CPU count, active session/request counts, blocked
    request count, buffer cache hit ratio, page life expectancy, batch
    requests/sec)
  - Top queries by CPU time, duration, logical reads, logical writes, or
    execution count (`sys.dm_exec_query_stats`)
  - Active sessions with live command/query text
  - Blocking chains (blocked session → blocker, wait resource)
  - Top wait types from `sys.dm_os_wait_stats`, filtered to exclude benign
    background waits
- React/Vite/TypeScript dashboard with a connection form and auto-polling
  panels for each of the above.
- README and setup instructions.
