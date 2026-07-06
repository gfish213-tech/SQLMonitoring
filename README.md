# SQL Performance Monitor

A live incident-triage tool for SQL Server: when someone says "the database is
slow," open this and see, at a glance, which of the usual suspects it is —
blocking, a backup/long-running operation, a SQL Agent job, CPU/memory
pressure, tempdb contention, a full transaction log, disk latency, recent
autogrowth events, or a deadlock. It's a complement to trend/daily monitoring
tools (e.g. DBADash), not a replacement — this tool only shows *current* state,
nothing historical.

## Stack

- **Server**: Node.js + Express + TypeScript, using the `mssql` package (via the
  `msnodesqlv8` native driver) to query SQL Server DMVs. Also serves the built
  React app as static files, so the whole thing runs as one process.
- **Client**: React + Vite + TypeScript. No auto-refresh by default — see
  Refresh behavior below.

## Authentication

The app connects to SQL Server using **Windows Integrated Authentication (a
trusted connection)** — there is no username/password. The connecting identity
is whichever Windows account the Node server process runs as. That account
**must be a member of the `sysadmin` fixed server role**; the server verifies
this immediately after connecting and refuses the connection (closing the pool)
if it isn't.

## Server list

There's no manual connection form — pick a server from a dropdown instead. The
list lives in `server/config/servers.json`, a plain JSON file you edit
directly (no rebuild needed, it's re-read on every request):

```json
{ "label": "sceboa5", "server": "sceboa5.sgp.is.keysight.com", "environment": "Production" }
```

`environment` drives a color-coded badge (Production/Staging/Development/
deprecated) so it's obvious at a glance which kind of server you're looking at.
Optional per-entry overrides: `database` (default `master`), `port`,
`instanceName`, `encrypt`, `trustServerCertificate` — useful if one server
needs something different from the defaults.

## Requirements

- **Windows**, since Integrated Authentication (trusted connection) requires
  the OS-level SSPI/Kerberos identity of the process.
- Node.js 18+, Python and a C++ build toolchain (needed to compile the native
  `msnodesqlv8` driver via node-gyp), and the Microsoft ODBC Driver for SQL
  Server installed on the host. The server auto-detects which ODBC driver
  version is installed (18, then 17, then the legacy Native Client) — nothing
  to configure.
- The Windows account running the server must be a SQL Server login with the
  `sysadmin` server role on every server in the list.

## Running it

Double-click `start.bat` in the repo root — it installs dependencies on
first run, builds, starts the server, and opens `http://localhost:4000` in
your browser automatically.

Or from the command line:

```bash
npm run install:all   # from repo root: installs both server/ and client/
npm run serve         # builds the client, then starts the one server process
```

Open `http://localhost:4000`. Pick a server, click **Connect**, click
**Refresh** whenever you want a fresh look.

(For active development on the UI with hot-reload, run `cd server && npm run
dev` and `cd client && npm run dev` in two terminals instead — see
`INSTRUCTIONS.md`.)

## Refresh behavior

**Manual by default.** This tool is often used to look at a server that's
already under load, so it must not add its own recurring query traffic
without being asked. Click **Refresh** to pull a fresh snapshot (one HTTP
request that runs all the checks below in parallel), or check **Auto-refresh
every 20s** to opt into polling. A refresh takes about a second by design:
the rate/pressure numbers (Batch Requests/sec, buffer cache hit ratio,
signal wait %) are measured over a real 1-second sample rather than shown
as misleading since-restart totals. **Copy for AI** copies the whole snapshot
(diagnosis + every panel's data) to the clipboard as plain text, ready to
paste into an AI chat for a second opinion or deeper analysis. A row of
**jump-to-section links** below Refresh stays pinned while you scroll, so
you can hop straight to any panel on what's otherwise a long page.

## What it shows

Numbers and panels that could otherwise be misread carry a hint: stats with
a small **ⓘ** explain what's being measured (hover it), and panels with a
filtering rule (e.g. "top 20 by CPU time", "last 24 hours") show that rule
in their header at all times, not just when the panel happens to be empty.

At the top, a **diagnosis banner** scores all 12 panels against thresholds
(e.g. blocking wait time, signal wait %, log/tempdb fullness, I/O latency) and
states the single most likely cause in plain language, with any other factors
that crossed a threshold available in a "N other potential factors"
expandable list. If nothing crossed a threshold, it says so plainly instead of
guessing. This is a heuristic pointer to where to look first, not a
replacement for reading the panel it points to.

Each section below states plainly when there's nothing to report (e.g. "No blocking
detected") so ruling a cause in or out is a glance, not a read:

- **Blocking & Long Transactions** — lead blockers (including sessions sitting
  idle with an open transaction) and everyone they're blocking.
- **Backups & Long-Running Operations** — BACKUP/RESTORE/DBCC/index rebuilds in
  progress, with % complete and ETA.
- **Running Agent Jobs** — currently-executing job steps with live CPU/IO.
- **Top Resource Consumers (Right Now)** — active requests ranked by current
  CPU, not historical totals.
- **Current Waits** — what's actually being waited on right now.
- **CPU & Memory Pressure** — signal wait % (CPU pressure), page life
  expectancy, buffer cache hit ratio, pending memory grants.
- **TempDB Contention** — space used and top allocating sessions.
- **Transaction Log Space** — flags any database with a log over 50% full (a
  full log halts writes entirely).
- **Disk / IO Latency** — per-file average read/write latency where elevated.
- **Recent Auto-Growth Events** — data/log file growth events in the last 24h,
  a common cause of sudden multi-second freezes.
- **Recent Deadlocks** — pulled from the `system_health` extended-events
  session (raw deadlock graph, no setup required).

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
