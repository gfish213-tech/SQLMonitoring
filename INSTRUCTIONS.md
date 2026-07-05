# Instructions

Step-by-step setup and usage for the SQL Performance Monitor.

## 1. Prerequisites

- **Windows**, since this app authenticates to SQL Server using Windows
  Integrated Authentication (a trusted connection) — there's no
  username/password anywhere in the app. It connects as whichever Windows
  account the server process runs as.
- That Windows account must be a SQL Server login with the **`sysadmin`**
  fixed server role. The server checks this immediately after connecting
  (`IS_SRVROLEMEMBER('sysadmin')`) and refuses the connection if it isn't —
  there is no lesser-privilege mode.
- Node.js 18 or later.
- A C++ build toolchain and Python (node-gyp needs both to compile the native
  `msnodesqlv8` driver during `npm install`) — on Windows this typically means
  Visual Studio Build Tools with the "Desktop development with C++" workload.
- The Microsoft ODBC Driver for SQL Server installed on the host.
- A running SQL Server instance reachable from this machine.

## 2. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

`npm install` in `server/` compiles the native `msnodesqlv8` driver — if the
build tools or ODBC driver above aren't installed, this step will fail with a
node-gyp/compiler error.

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
2. Fill in Server/Host, Port (default `1433`), Instance Name (only if
   connecting to a named instance, e.g. `SQLEXPRESS`), and Database.
3. Leave **Encrypt connection** unchecked unless your SQL Server requires TLS
   and you know the ODBC driver on this host trusts its certificate.
4. Click **Test Connection** to verify access without switching the active
   session, or **Connect** to go straight to the dashboard. Either one will
   fail with an "Access denied" error if the Windows account running the
   server isn't a `sysadmin` on that instance.

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

- The server holds one active connection pool in memory per process. No
  credentials are ever collected or stored — authentication is entirely
  delegated to the Windows identity the server process runs as, verified as
  `sysadmin` on every connect.
- There is no built-in authentication layer for the web UI itself. If
  deploying beyond local/trusted use, put it behind your own auth or reverse
  proxy — don't expose port 4000 or 5173 directly to an untrusted network.
  Anyone who can reach the API can drive queries against your SQL Server
  through this sysadmin-privileged connection.
