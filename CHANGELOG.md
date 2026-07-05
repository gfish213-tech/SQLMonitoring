# Version History

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
