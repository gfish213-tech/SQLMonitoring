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

**Manual by default, and three weights of refresh.** This tool is often used
to look at a server that's already under load, so it must not add its own
recurring query traffic without being asked — and even when asked, it
shouldn't necessarily run everything. **Quick Refresh** (used on page load,
this button, and auto-refresh) runs only the small, single-pass checks:
Overview, Blocking, Backups/Long Ops, Agent Jobs, Waits, Pressure, Log
Space. **Full Refresh** additionally runs the heavier checks — Consumers,
TempDB, VLF Counts, IO Latency, Autogrowth, Deadlocks, Disk Volume Space,
Indexes. Tabs/sections not covered by the last refresh show a dashed "not
checked" placeholder and a dim gray tab dot, distinct from a red dot
("checked, found something") or no dot ("checked, clean"). A **↻ Refresh
&lt;Tab&gt;** button above every tab's content re-runs just that tab's
query — lighter than either Quick or Full Refresh, for when you only want
to update the one thing you're watching. Check
**Auto-refresh every 20s** to opt into polling — quick only, never full. A
refresh takes about a second by design: the rate/pressure numbers (Batch
Requests/sec, buffer cache hit ratio, signal wait %) are measured over a
real 1-second sample rather than shown as misleading since-restart totals.
**Copy for AI** copies the whole snapshot (diagnosis + every panel's data,
noting anything not yet checked) to the clipboard as plain text, ready to
paste into an AI chat for a second opinion or deeper analysis.

## What it shows

At the top, a **diagnosis banner** scores all 12 panels against thresholds
(e.g. blocking wait time, signal wait %, log/tempdb fullness, I/O latency) and
states the single most likely cause in plain language, with any other factors
that crossed a threshold available in a "N other potential factors"
expandable list — each with a **View details →** button that jumps straight
to the relevant tab. Every finding also carries a **💡 What to do** line — a
concrete first-response action (who to contact, what to kill and what never
to kill, whether it's a log backup or a shrink, which tab to check next) so
the tool doesn't just name the cause but says what to actually do about it.
If nothing crossed a threshold, it says so plainly instead of guessing. This
is a heuristic pointer to where to look first, not a replacement for reading
the panel it points to.

Below that, a **tab strip** (pinned to the top while you scroll) switches
between Overview, Blocking, Consumers, Backups, Agent Jobs, Waits, Log
Space, IO Latency, Autogrowth, Deadlocks, and Indexes — only one tab's
content is shown at a time. A tab gets a red dot if it found something, no
dot if it's clean, or a dim gray dot if it's a full-only tab that hasn't
been checked yet (run **Full Refresh** to check it).

Numbers and panels that could otherwise be misread carry a hint: stats with
a small **ⓘ** explain what's being measured (hover it), and panels with a
filtering rule (e.g. "top 20 by CPU time", "last 24 hours") show that rule
in their header at all times, not just when the panel happens to be empty.

Each section below states plainly when there's nothing to report (e.g. "No blocking
detected") so ruling a cause in or out is a glance, not a read:

- **Blocking & Long Transactions** — lead blockers (including sessions sitting
  idle with an open transaction) and everyone they're blocking.
- **Backups & Long-Running Operations** — BACKUP/RESTORE/DBCC/index rebuilds in
  progress, with % complete and ETA.
- **Running Agent Jobs** — currently-executing job steps with live CPU/IO.
- **Top Resource Consumers (Right Now)** — active sessions, returned as the
  union of the top consumers by CPU, disk IO, and memory grant (not just a
  CPU-sorted list, so an IO- or memory-heavy session that isn't a top CPU
  consumer still shows up); each row shows logical vs. physical disk reads,
  writes, TempDB usage, memory grant (held or waiting), and the actual
  query text — one place to see who's driving CPU, memory, and disk I/O
  right now, and what it's running. Click any resource column to sort by
  it; a "Hide 'sa' session" checkbox filters out that login.
- **Current Waits** — what's actually being waited on right now.
- **CPU & Memory Pressure** — signal wait % (CPU pressure), page life
  expectancy, buffer cache hit ratio, pending memory grants, and worker
  thread/scheduler exhaustion (runnable tasks, worker queue).
- **TempDB Contention** — space used, broken down into user objects,
  internal objects, and version store, plus top allocating sessions.
- **Disk Volume Space** — every OS volume hosting a SQL Server file, with
  free space/%, so a drive running low shows up without remoting in to
  check Windows Explorer.
- **Plan Cache / Ad-hoc Queries** — plan cache size and the ad-hoc share,
  so an application sending raw SQL instead of parameterized queries shows
  up as plan cache pollution competing with the buffer pool for memory.
- **Transaction Log Space** — flags any database with a log over 50% full (a
  full log halts writes entirely), plus VLF (virtual log file) counts —
  fragmentation that slows down recovery and failovers.
- **Disk / IO Latency** — both the since-restart average and a live
  1-second-delta reading (plus IOPS and MB/s throughput) per file, so a
  current spike isn't hidden by good historical averages.
- **Recent Auto-Growth Events** — data/log file growth events in the last 24h,
  a common cause of sudden multi-second freezes.
- **Recent Deadlocks** — pulled from the `system_health` extended-events
  session (raw deadlock graph, no setup required).
- **Indexes** — top tables by scan count (a possible missing-index signal)
  and unused indexes (written to but never read — pure write overhead).

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
