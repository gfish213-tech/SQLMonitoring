# SQL Performance Monitor

A web dashboard for monitoring SQL Server performance in real time: top expensive
queries, active sessions, blocking chains, and wait statistics — sourced directly
from SQL Server's dynamic management views (DMVs).

## Stack

- **Server**: Node.js + Express + TypeScript, using the `mssql` package (via the
  `msnodesqlv8` native driver) to query SQL Server DMVs.
- **Client**: React + Vite + TypeScript, polling the API on an interval per panel.

## Authentication

The app connects to SQL Server using **Windows Integrated Authentication (a
trusted connection)** — there is no username/password. The connecting identity
is whichever Windows account the Node server process runs as. That account
**must be a member of the `sysadmin` fixed server role**; the server verifies
this immediately after connecting and refuses the connection (closing the pool)
if it isn't.

## Requirements

- **Windows**, since Integrated Authentication (trusted connection) requires
  the OS-level SSPI/Kerberos identity of the process. (The `msnodesqlv8` driver
  can technically build on Linux/macOS with unixODBC + the Microsoft ODBC
  Driver installed, but trusted-connection auth in that configuration depends
  on the host being domain-joined — Windows is the supported path.)
- Node.js 18+, Python and a C++ build toolchain (needed to compile the native
  `msnodesqlv8` driver via node-gyp), and the Microsoft ODBC Driver for SQL
  Server installed on the host.
- The Windows account running the server must be a SQL Server login with the
  `sysadmin` server role (this also covers `VIEW SERVER STATE`, needed to read
  the DMVs this tool queries).

## Running locally

In one terminal, start the API server:

```bash
cd server
npm install
npm run dev
```

The server listens on `http://localhost:4000`.

In another terminal, start the web client:

```bash
cd client
npm install
npm run dev
```

The client runs on `http://localhost:5173` (Vite proxies `/api` to the server).
Open it in a browser, enter the server/database (and instance name, if any),
and click **Connect** — no credentials needed, it uses the server process's
Windows identity.

## What it shows

- **Overview**: CPU count, active sessions/requests, blocked request count,
  buffer cache hit ratio, page life expectancy, batch requests/sec.
- **Blocking Chains**: sessions currently blocked, and by whom.
- **Top Queries**: ranked by CPU time, duration, logical reads, logical writes,
  or execution count, sourced from `sys.dm_exec_query_stats`.
- **Active Sessions**: currently connected sessions and what they're running.
- **Top Wait Types**: aggregated wait stats from `sys.dm_os_wait_stats`,
  filtered to exclude benign background waits.

## Notes

- The connection pool is held in memory on the server process for the current
  session only; no credentials are ever collected or stored, since auth is
  entirely delegated to the Windows identity the process runs as.
- This is a single-connection monitoring tool, not a multi-tenant service; it
  has no authentication layer of its own for the web UI itself. Don't expose
  the server port directly to an untrusted network — put it behind your own
  auth/reverse proxy if deploying beyond local use.
- Access is gated on the SQL Server side: only a Windows account with the
  `sysadmin` server role can use this tool. There's no lesser-privilege mode.
