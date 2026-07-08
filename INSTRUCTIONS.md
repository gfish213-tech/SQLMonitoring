# Instructions

Step-by-step setup and usage for the SQL Performance Monitor.

## 1. Prerequisites

- **Windows**, since this app authenticates to SQL Server using Windows
  Integrated Authentication (a trusted connection) — there's no
  username/password anywhere in the app. It connects as whichever Windows
  account the server process runs as.
- That Windows account must be a SQL Server login with the **`sysadmin`**
  fixed server role on every server you want to monitor. The server checks
  this immediately after connecting (`IS_SRVROLEMEMBER('sysadmin')`) and
  refuses the connection if it isn't — there is no lesser-privilege mode.
- Node.js 18 or later.
- A C++ build toolchain and Python (node-gyp needs both to compile the native
  `msnodesqlv8` driver during `npm install`) — on Windows this typically means
  Visual Studio Build Tools with the "Desktop development with C++" workload.
- The Microsoft ODBC Driver for SQL Server installed on the host (17 or 18 —
  the app auto-detects which one you have).

## 2. Configure your server list

Edit `server/config/servers.json` — a plain JSON array, one entry per server:

```json
[
  { "label": "sceboa5", "server": "sceboa5.sgp.is.keysight.com", "environment": "Production" },
  { "label": "sceboa91", "server": "sceboa91.png.is.keysight.com", "environment": "Development" }
]
```

- `label` and `environment` only affect the dropdown display (environment
  drives a color-coded badge — Production shows red, Staging orange,
  Development green, anything with "no longer" in it shows struck-through).
- `server` is the hostname the app actually connects to.
- Optional per-entry fields if a particular server needs something
  non-default: `database` (default `master`), `port`, `instanceName` (for a
  named instance), `encrypt`, `trustServerCertificate`.
- This file is re-read on every request — add/remove servers without
  restarting anything.

## 3. Install dependencies and run

**Easiest: double-click `start.bat`** in the repo root. It installs
dependencies on first run (if `server/node_modules` is missing), builds and
starts the app, waits for it to come up, then opens
`http://localhost:4000` in your default browser automatically. A console
window titled "SQL Performance Monitor" stays open while it's running —
closing that window stops the server.

Or from the command line, from the repo root:

```bash
npm run install:all   # installs server/ and client/ separately
npm run serve         # builds the client, then starts the one Express process
```

Open `http://localhost:4000`. `npm install` in `server/` compiles the native
`msnodesqlv8` driver — if the build tools or ODBC driver above aren't
installed, this step fails with a node-gyp/compiler error.

Set `PORT` to change the port (`PORT=8080 npm start` from `server/`).

### Developing the UI (hot-reload)

If you're actively changing the client and want fast reloads instead of
rebuilding every time, run two terminals instead of `npm run serve`:

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```

This runs Vite's dev server on `http://localhost:5173`, proxying `/api` to the
Express server on `:4000`. This is a development-only convenience — end users
should just run `npm run serve` from the root.

## 4. Connect to a server

1. Open the app. Pick a server from the dropdown — the environment badge next
   to it tells you Production/Staging/Development/deprecated at a glance.
2. Click **Test Connection** to check access without switching the active
   session, or **Connect** to go straight to the dashboard.
3. Either one fails with a clear error if: the Windows account isn't
   `sysadmin` on that server, the server/instance name is wrong, the ODBC
   driver can't reach it, or (if `encrypt` is on) there's a certificate trust
   problem — the message tells you which.

## 5. Using the dashboard

There is **no automatic refresh by default**, and refreshing comes in three
weights — this tool often gets used against a server that's already
struggling, so it must not add its own recurring query load, and even an
explicit refresh shouldn't necessarily run everything. **Quick Refresh**
(also what runs on page load and on auto-refresh) covers only the small,
single-pass checks: Overview, Blocking, Backups/Long Ops, Agent Jobs, Waits,
Pressure, Log Space. **Full Refresh** additionally runs the heavier checks —
Consumers, TempDB, VLF Counts, IO Latency, Autogrowth, Deadlocks, Disk
Volume Space, Indexes. Anything not covered by your last refresh shows a
dashed "not checked — run Full Refresh" placeholder instead of an empty
state, so you're never misled into thinking a section was checked and came
back clean when it just wasn't looked at. A **↻ Refresh &lt;Tab&gt;** button
above the current tab's content is the third, lightest option — it
re-runs only that one tab's query (useful if you're watching, say,
Consumers while a query finishes and don't want to pay for a whole Quick
or Full Refresh), and it can also populate a single full-only tab on its
own without running the rest of a Full Refresh. Check **Auto-refresh every 20s**
if you want to opt into polling while you watch something resolve — this
always uses Quick Refresh, never Full. Each refresh takes about one
second — that's deliberate: the rate numbers (Batch Requests/sec, buffer
cache hit ratio, signal wait %) are measured over a real 1-second sample
instead of being shown as since-restart totals. Click **Copy for AI** to
copy the entire snapshot — the diagnosis plus every panel's data (noting
anything not yet checked), spelled out as plain text — to your clipboard,
ready to paste into an AI chat if you want a second opinion or help
interpreting something unfamiliar.

Right below the refresh bar, a **diagnosis banner** does the first pass for
you: it scores every panel's data against fixed thresholds and states the
single most likely cause in plain language (e.g. "Most likely cause: Blocking
— Session 82 is blocking 2 other sessions"), with a **View details →** button
that jumps straight to that panel's tab, and a "N other potential factors"
expandable list (each with its own jump button) for anything else that
crossed a threshold. Under every finding there's a **💡 What to do** line
with a concrete first-response action: for a blocking chain, who to contact
and what `KILL` would release (and roll back); for a full transaction log,
to check `log_reuse_wait_desc` and take a *log backup* (not a shrink); for a
rollback in progress, explicitly *don't* kill it; for CPU/memory pressure,
which tab to open to find the runaway query — and so on. These are standard
DBA first responses, not a substitute for judgment: read the panel before
killing anything. If nothing crossed a threshold, the banner says so instead
of guessing — that's not the same as "the server isn't actually slow," just
that nothing here crossed a concerning line.

Below that is a **tab strip** — Overview, Blocking, Consumers, Backups,
Agent Jobs, Waits, Log Space, IO Latency, Autogrowth, Deadlocks, Indexes —
that stays pinned to the top of the screen as you scroll. Only one tab's
content shows at a time; a tab gets a red dot if it found something, no dot
if it's clean, or a dim gray dot if it's a full-only tab that your last
refresh didn't check (Consumers, IO Latency, Autogrowth, Deadlocks, and
Indexes are always full-only; TempDB and Disk Volume Space within Overview
are too) — click **Full Refresh** to check those. Hover the small **ⓘ**
next to any stat for a one-line explanation of what it means and how it's
measured; panels with a filtering rule (e.g. "top 20 by CPU time") show
that rule in their header at all times, not only when the panel happens to
be empty.

Every panel states plainly when there's nothing to report, so ruling a cause
in or out is a glance. The **Overview** tab combines the always-on server
vitals — CPU/session/request counts, CPU & Memory Pressure (including
worker thread/scheduler exhaustion), TempDB Contention, Disk Volume Space,
and Plan Cache/Ad-hoc query stats — and the rest are one tab each:

- **Blocking & Long Transactions** — who's blocking whom, including a session
  sitting idle with an open transaction (a common, easy-to-miss cause).
- **Backups & Long-Running Operations** — BACKUP/RESTORE/DBCC/index rebuild
  progress with ETA.
- **Running Agent Jobs** — currently-executing jobs with live CPU/IO.
- **Top Resource Consumers (Right Now)** — active sessions, returned as
  whichever are the top consumers by CPU, disk IO (physical reads/writes),
  *or* memory grant — not just a CPU-sorted list, so a session that's
  hammering the disk or holding a huge memory grant but isn't CPU-heavy
  still shows up. Click any of the resource column headers (CPU, Elapsed,
  Logical/Physical Reads, Writes, TempDB, Memory Grant) to sort by it,
  click again to reverse — that's instant, it's just re-ordering rows
  already on the page. Each row also shows a Memory Grant column — either
  the amount a session currently holds, or "waiting for N MB" in amber if
  it's queued behind one (most sessions never need a grant at all; a "-"
  here is normal) — and the actual query text. A "Hide 'sa' session"
  checkbox (off by default) is there if a maintenance/monitoring login
  clutters the list. This is the one panel that answers "who's using the
  most CPU, memory, or disk I/O right now, and what exactly is it running"
  in a single table.
- **Current Waits** — what's actually being waited on right now.
- **CPU & Memory Pressure** — signal wait % (CPU pressure indicator), page
  life expectancy, buffer cache hit ratio, pending memory grants, runnable
  tasks and worker queue (worker thread exhaustion — always critical if
  non-zero).
- **TempDB Contention** — space used, broken down into user objects,
  internal objects, and version store, plus which sessions are using the
  most.
- **Disk Volume Space** — every drive hosting a SQL Server file, with free
  space/% — flagged red under 10% free.
- **Plan Cache / Ad-hoc Queries** — plan cache size, ad-hoc share, and
  single-use ad-hoc plan count/size — a high share means an application is
  sending raw SQL strings instead of parameterized queries or stored
  procedures, wasting memory that competes with the buffer pool.
- **Transaction Log Space** — flags any database with its log over 50% full,
  plus a separate VLF (virtual log file) count check — a fragmented log
  (over 100 VLFs) slows recovery and failovers, independent of how full
  the log currently is (requires SQL Server 2017+).
- **Disk / IO Latency** — both the since-restart average and a live
  1-second reading (plus IOPS/MB per second) per file; flagged if either
  one is elevated, so a current spike isn't hidden by good history.
- **Recent Auto-Growth Events** — file growth events in the last 24 hours.
- **Recent Deadlocks** — raw deadlock graphs from `system_health`, expandable.
- **Indexes** — "Top Tables by Scans" (a high scan count relative to seeks
  can mean a missing index) and "Unused Indexes" (written to but never
  read — pure overhead on every insert/update). Shows the table name and
  index ID rather than the index's name, to keep this reliable across
  arbitrary multi-database servers without per-database dynamic SQL.

Click **Switch Server** in the header to disconnect and pick a different one.

## 6. Building for production

`npm run serve` from the repo root does a full build + start in one step. If
you want to separate the steps (e.g. building once, then starting later or via
a process manager):

```bash
npm run build   # from repo root: builds client, then server
npm start        # from repo root: starts the server (serves the built client too)
```

## Security notes

- The server holds one active connection pool in memory per process. No
  credentials are ever collected or stored — authentication is entirely
  delegated to the Windows identity the server process runs as, verified as
  `sysadmin` on every connect.
- There is no built-in authentication layer for the web UI itself. If
  deploying beyond local/trusted use, put it behind your own auth or reverse
  proxy — don't expose the port directly to an untrusted network. Anyone who
  can reach it can drive queries against your SQL Server through this
  sysadmin-privileged connection.
