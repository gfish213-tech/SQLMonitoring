# Version History

## Unreleased

### Fixed
- `consumers.ts`'s per-session tempdb calculation had a paren mismatch that
  put the `* 8.0 / 1024` cast math inside `SUM(...)`'s own argument list,
  which made SQL Server parse it as a call to a nonexistent table function
  and fail with `'SUM' is not a recognized built-in function name`.
- `/api/triage` now labels each panel's query (e.g. `[consumers] ...`) on
  failure, so a bad query names itself instead of surfacing a bare,
  unattributed error.

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
