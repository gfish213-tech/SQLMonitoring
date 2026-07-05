# SQL Performance Monitor

A web dashboard for monitoring SQL Server performance in real time: top expensive
queries, active sessions, blocking chains, and wait statistics — sourced directly
from SQL Server's dynamic management views (DMVs).

## Stack

- **Server**: Node.js + Express + TypeScript, using the `mssql` package to query
  SQL Server DMVs.
- **Client**: React + Vite + TypeScript, polling the API on an interval per panel.

## Requirements

- Node.js 18+
- A reachable SQL Server instance and a login with `VIEW SERVER STATE` permission
  (needed to read the DMVs used by this tool).

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
Open it in a browser, enter your SQL Server connection details, and click
**Connect**.

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

- The connection is held in memory on the server process for the current
  session only — credentials are never written to disk.
- This is a single-connection monitoring tool, not a multi-tenant service; it
  has no authentication layer of its own. Don't expose the server port
  directly to an untrusted network — put it behind your own auth/reverse
  proxy if deploying beyond local use.
