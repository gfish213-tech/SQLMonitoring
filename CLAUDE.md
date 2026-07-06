# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SQL Performance Monitor — a live incident-triage tool for SQL Server: pick a
server, click Refresh, and see which of ~11 known causes of "the DB is slow"
is currently in play (blocking, a backup/long-op, an Agent job, CPU/memory
pressure, tempdb contention, a full log, disk latency, autogrowth, deadlocks).
It deliberately shows only *current* state, not trends — trend/daily
monitoring is handled by a separate tool (DBADash) the user already has. See
`README.md` for the full panel list and `INSTRUCTIONS.md` for setup/usage.

## Commands

Two independent npm projects under one thin root-level orchestration layer
(not a workspace — `server/` and `client/` each have their own
`node_modules`/lockfile).

```bash
# From repo root — the primary way this app is meant to be run
npm run install:all   # npm install in both server/ and client/
npm run build          # builds client, then server
npm start               # starts the server, which also serves the built client
npm run serve            # build + start in one shot

# Server (Express + TypeScript API + static file host, port 4000 by default)
cd server
npm run dev      # tsx watch, hot-reload — for active backend development only
npm run build    # tsc -> dist/
npm start        # run built dist/index.js

# Client (React + Vite + TypeScript)
cd client
npm run dev      # vite dev server on 5173, proxies /api to localhost:4000 — for active frontend development only
npm run build    # tsc -b && vite build -> dist/
```

There are no lint or test scripts configured in either project.

`server`'s `npm install` compiles the native `msnodesqlv8` driver via
node-gyp — this requires a C++ build toolchain and the Microsoft ODBC Driver
for SQL Server on the host, and in practice requires Windows (see
Authentication below). It will not build in a plain Linux/macOS dev sandbox
without unixODBC + the ODBC driver installed, and even then trusted-connection
auth needs the host to be domain-joined. **This means the server cannot be
boot-tested in most CI/sandbox environments** — verify server-side changes by
`tsc --noEmit`, code review, and a mock Express server serving canned JSON
(for exercising the client), rather than assuming `npm run dev`/`npm start`
will boot the real server. See the "Verifying changes" section below.

## Authentication

The app authenticates to SQL Server via **Windows Integrated Authentication
(trusted connection)** only — there is no username/password field or SQL
login path anywhere in the code. The connecting identity is always whichever
Windows account the Node server process runs as.

Every `connect()`/`testConnection()` call in `db.ts` runs
`IS_SRVROLEMEMBER('sysadmin')` right after opening the pool and throws
(closing the pool) if the result isn't `1`. This is a hard gate with no
lesser-privilege mode — don't add a bypass or a lower-privilege code path
without being asked; it's a deliberate security requirement, not a default
that happens to be strict.

## Connection string / ODBC driver handling

`mssql`'s own `msnodesqlv8` connection-string builder (inside the `mssql`
package itself) hardcodes the driver name to the deprecated "SQL Server
Native Client 11.0" on Windows and never wires up `TrustServerCertificate` at
all — both real gaps in the library, not something to route around lightly.
`db.ts` builds the connection string itself via `@tediousjs/connection-string`
and passes it through the `connectionString` config key (which
`mssql/lib/msnodesqlv8/connection-pool.js` uses verbatim, bypassing the
library's own builder entirely). It also probes installed ODBC drivers in
order (`ODBC Driver 18 for SQL Server` → `17` → `SQL Server Native Client
11.0`) using the raw `msnodesqlv8` promises API before opening the real pool,
and remembers whichever one worked (module-level `workingDriver` cache).

The native driver reports errors as plain objects (or arrays of them) shaped
`{ message, sqlstate, code }`, not `Error` instances — `mssql`'s own error
wrapping only preserves `.message` when the source `instanceof Error`, so a
plain-object error silently became `"[object Object]"` before this was fixed.
`extractDriverError()` in `db.ts` pulls the real text off whatever shape
comes back; don't reintroduce a bare `(err as Error).message` on errors from
this driver.

## Server list

There's no connection form — `server/config/servers.json` is a hardcoded,
user-edited list of servers (label, hostname, environment, optional
overrides for database/port/instanceName/encrypt/trustServerCertificate).
`server/src/serverList.ts` re-reads it from disk on every call (cheap, small
file) so edits take effect without a rebuild or restart. `routes/connection.ts`
only ever accepts a bare `server` hostname from the client and looks up the
rest from this config — the client never sends connection details other than
which server was picked.

## Refresh behavior

Deliberately **no default auto-refresh** — this tool is often used against a
server that's already struggling, so it must not add its own recurring query
load. `client/src/hooks/useTriage.ts` fetches once on mount and otherwise only
on an explicit `refresh()` call (the Refresh button) or when the user opts
into the `autoRefresh` toggle (20s interval). Don't add a default interval to
this hook or reintroduce per-panel polling — the whole design fetches
everything in one combined request (`GET /api/triage`) specifically to avoid
1 client generating 11 separate polling loops.

## Architecture

### Server (`server/src`)

- `db.ts` — owns a single in-memory `ConnectionPool` (from
  `mssql/msnodesqlv8`, not plain `mssql`) for the whole process (module-level
  singleton, not per-request). `connect()`/`testConnection()` both go through
  `openVerifiedPool()`, which resolves the connection string (see above),
  opens the pool, runs the sysadmin check, and closes the pool again on any
  failure. `getPool()` throws if nothing is connected yet. No credentials are
  ever collected or stored — auth is entirely delegated to the OS identity.
- `serverList.ts` — reads/validates `config/servers.json` (see above).
- `types/mssql-msnodesqlv8.d.ts` — ambient module declaration aliasing
  `mssql/msnodesqlv8`'s types to the `mssql` package's types, since
  `@types/mssql` doesn't cover that driver subpath.
- `routes/connection.ts` — pool lifecycle endpoints (`servers`, `test`,
  connect, `status`, `disconnect`). Mounted at `/api/connection`. Enriches
  `ConnectionMeta` with `label`/`environment` from the matched
  `config/servers.json` entry before returning it to the client.
- `routes/dashboard.ts` — a single combined `GET /api/triage` endpoint that
  runs every `sql/*.ts` query via `Promise.all` and returns one JSON object
  (see Refresh behavior above for why it's one endpoint, not eleven). Mounted
  at `/api`, and applies a `requireConnection` middleware via `router.use()`
  with no path — this matches **every** request that reaches this router,
  unconditionally.
- `sql/*.ts` — one file per diagnostic check (`overview`, `blocking`,
  `longOps`, `agentJobs`, `consumers`, `currentWaits`, `pressure`, `tempdb`,
  `logSpace`, `ioLatency`, `autogrowth`, `deadlocks`), each exporting a typed
  async function that runs against `getPool()`. Notable ones:
  - `blocking.ts` — computes "lead blockers" (blockers not themselves
    waiting on anyone) in TypeScript from two queries, including blockers
    that are idle with an open transaction (`sys.dm_exec_sessions.status =
    'sleeping'` + `open_transaction_count > 0`) — a common, easy-to-miss
    blocking cause that a naive "who's blocking" query misses entirely.
  - `agentJobs.ts` — matches a running job to its live session by computing
    the job_id-as-hex string *in SQL* (`CAST(job_id AS varbinary(16))`,
    style 2) and matching it against `sys.dm_exec_sessions.program_name`.
    Don't try to replicate SQL Server's GUID-to-hex byte ordering in
    JavaScript — it's a well-known source of subtle bugs.
  - `tempdb.ts` — the version-store query (`sys.dm_tran_version_store_space_
    usage`) requires SQL Server 2016 SP2+/2017+; wrapped in its own
    `.catch(() => 0)` so older versions still return the rest of the panel.
  - `autogrowth.ts`, `deadlocks.ts` — read from the default trace / the
    `system_health` extended-events session respectively, both of which are
    on by default but can be disabled by policy; both catch and return an
    empty array rather than erroring the whole `/api/triage` call.
  - No query here should ever return unfiltered historical/cumulative data
    (that's what DBADash is for) — every panel is either instantaneous
    (`sys.dm_exec_requests`, `sys.dm_os_waiting_tasks`) or explicitly
    thresholded down to "not normal" (e.g. `logSpace.ts` only returns
    databases over 50% log used, `ioLatency.ts` only returns files over
    15ms average latency).
- `index.ts` — wires up the app, then serves the built client. **Route
  registration order matters**: `dashboardRouter` is mounted at the same
  `/api` prefix as other routes, and its unconditional `requireConnection`
  middleware will swallow *any* route registered after it under `/api` (this
  already broke `/api/health` once). Static file serving + the catch-all
  route for the client must come *after* all `/api/*` routes; it resolves
  `client/dist` via `path.resolve(__dirname, "../../client/dist")`, which
  works whether running from `server/src` (tsx dev) or `server/dist`
  (compiled) since both are two directories below the repo root.

### Client (`client/src`)

- `api.ts` — the single fetch client; every server call goes through the
  `request()` wrapper, which throws using the server's `{ error }` JSON body
  on non-2xx responses (and falls back to a generic message if `error` isn't
  a string, so a server-side bug can't surface as `[object Object]` again).
- `types.ts` — manually mirrors the server's response shapes (there's no
  shared types package between `client` and `server`); update both sides
  together when changing an API response shape.
- `hooks/useTriage.ts` — see Refresh behavior above.
- `components/ServerPicker.tsx` — the connect screen: a `<select>` populated
  from `GET /api/connection/servers`, with an environment badge, replacing
  what used to be a manual connection form.
- `components/Section.tsx` — shared wrapper for panels with an empty state;
  most panel components use it. `OverviewBar`, `PressurePanel`, and
  `TempdbPanel` render their own stat grids directly instead (no
  empty/populated distinction needed for always-present server vitals).
- `App.tsx` — top-level state machine: checks `/api/connection/status` on
  mount, then renders either `ServerPicker` or the `Dashboard` (all 11 panel
  components, driven by `useTriage`) once connected.
- Styling is a single hand-written `styles.css` (no CSS framework/CSS-in-JS).

## Verifying changes

Since the real server can't boot in most sandboxes (see Commands above),
verify UI/data-flow changes with a mock Express server on `:4000` serving
canned JSON matching the current `TriageData`/`ConnectionMeta`/
`ServerListEntry` shapes from `types.ts`, run the client's Vite dev server
against it, and check with Playwright/Chromium (`/opt/pw-browsers/chromium`
is preinstalled in this environment). Always verify both the empty state and
a populated state for any panel you touch — the empty-state text is a
first-class part of the product (a DBA needs "no blocking detected" to read
as confidently ruled-out, not "no data").

## Maintaining docs

When making a meaningful change (new feature, endpoint, DMV query, behavior
change, or bug fix worth noting), update these alongside the code — don't
leave them to drift:

- `CHANGELOG.md` — add an entry under a new version heading (or an
  `Unreleased` section if no version bump is requested) describing what
  changed.
- `README.md` — update if the feature list, stack, or high-level "what it
  shows" section is affected.
- `INSTRUCTIONS.md` — update if setup steps, commands, or user-facing usage
  changes.
- `CLAUDE.md` (this file) — update if the architecture, file responsibilities,
  or commands change.
