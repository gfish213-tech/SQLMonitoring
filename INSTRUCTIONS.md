# Instructions

Step-by-step setup and usage for the SQL Performance Monitor.

## 1. Prerequisites

- Node.js 18 or later
- A running SQL Server instance reachable from this machine
- A SQL Server login with `VIEW SERVER STATE` permission (required to read the
  DMVs this tool queries: `sys.dm_exec_query_stats`, `sys.dm_exec_sessions`,
  `sys.dm_exec_requests`, `sys.dm_os_wait_stats`, `sys.dm_os_performance_counters`)

## 2. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

## 3. Start the API server

```bash
cd server
npm run dev
```

Runs on `http://localhost:4000`. Set `PORT` to change it.

## 4. Start the web client

In a second terminal:

```bash
cd client
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api` requests to the server.

## 5. Connect to your database

1. Open `http://localhost:5173` in a browser.
2. Fill in Server/Host, Port (default `1433`), Database, Username, Password.
3. Leave **Encrypt connection** checked for most setups. Check **Trust server
   certificate** if your SQL Server uses a self-signed certificate (common in
   dev/on-prem environments without a CA-issued cert).
4. Click **Test Connection** to verify credentials without switching the
   active session, or **Connect** to go straight to the dashboard.

## 6. Using the dashboard

- **Overview** — CPU cores, active session/request counts, blocked request
  count, buffer cache hit ratio, page life expectancy, batch requests/sec.
  Refreshes every 5 seconds.
- **Blocking Chains** — shows only when a session is being blocked by
  another; lists the blocked session, the blocker, and the wait resource.
  Refreshes every 5 seconds.
- **Top Queries** — switch the metric (CPU Time, Duration, Logical Reads,
  Logical Writes, Executions) to re-sort; hover a query to see the full text.
  Refreshes every 10 seconds.
- **Active Sessions** — all current user sessions; rows highlight red when
  blocked. Refreshes every 5 seconds.
- **Top Wait Types** — aggregate wait time since the last SQL Server restart,
  with common background waits filtered out. Refreshes every 10 seconds.

Click **Disconnect** in the header to close the pool and return to the
connection form.

## 7. Building for production

```bash
cd server && npm run build && npm start
cd client && npm run build   # outputs static assets to client/dist
```

Serve `client/dist` with any static file host, and point it at the API
server (update the proxy/base URL as needed for your deployment).

## Security notes

- The server holds one active connection pool in memory per process;
  credentials are never written to disk.
- There is no built-in authentication layer for the web UI itself. If
  deploying beyond local/trusted use, put it behind your own auth or reverse
  proxy — don't expose port 4000 or 5173 directly to an untrusted network.
