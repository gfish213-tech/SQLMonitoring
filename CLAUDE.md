# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SQL Performance Monitor — a web dashboard for monitoring SQL Server performance
in real time (top expensive queries, active sessions, blocking chains, wait
stats), sourced from SQL Server DMVs. See `README.md` for the feature list and
`INSTRUCTIONS.md` for end-user setup/usage.

## Commands

This is two independent npm projects (no workspace/monorepo tooling) — run
commands from within `server/` or `client/`, not the repo root.

```bash
# Server (Express + TypeScript API, port 4000)
cd server
npm install
npm run dev      # tsx watch, hot-reload
npm run build    # tsc -> dist/
npm start        # run built dist/index.js

# Client (React + Vite + TypeScript, port 5173)
cd client
npm install
npm run dev      # vite dev server, proxies /api to localhost:4000
npm run build    # tsc -b && vite build -> dist/
npm run preview  # preview the production build
```

There are no lint or test scripts configured in either project.

## Architecture

### Server (`server/src`)

- `db.ts` — owns a single in-memory `mssql` `ConnectionPool` for the whole
  process (module-level singleton, not per-request). `connect()` replaces
  the active pool; `getPool()` throws if nothing is connected yet. Credentials
  are never persisted — they only ever live in this in-memory pool config.
- `routes/connection.ts` — pool lifecycle endpoints (`test`, connect,
  `status`, `disconnect`). Mounted at `/api/connection`.
- `routes/dashboard.ts` — all data endpoints (`overview`, `queries/top`,
  `sessions`, `blocking`, `waits`). Mounted at `/api`, and applies a
  `requireConnection` middleware via `router.use()` with no path — this
  matches **every** request that reaches this router, unconditionally.
- `sql/*.ts` — one file per DMV-backed query (`overview`, `topQueries`,
  `activeSessions`, `blocking`, `waitStats`), each exporting a typed async
  function that runs against `getPool()`. `topQueries.ts` whitelists the sort
  column via a `TopQueryMetric -> column` map before interpolating it into
  the `ORDER BY` clause — do not interpolate user input into SQL elsewhere
  without the same kind of whitelist.
- `index.ts` — wires up the app. **Route registration order matters**:
  `dashboardRouter` is mounted at the same `/api` prefix as other routes, and
  its unconditional `requireConnection` middleware will swallow *any* route
  registered after it under `/api` (this already broke `/api/health` once —
  it must be registered before `dashboardRouter`). When adding new top-level
  `/api/*` routes that shouldn't require a DB connection, register them
  before `app.use("/api", dashboardRouter)`.

### Client (`client/src`)

- `api.ts` — the single fetch client; every server call goes through the
  `request()` wrapper, which throws using the server's `{ error }` JSON body
  on non-2xx responses.
- `types.ts` — manually mirrors the server's response shapes (there's no
  shared types package between `client` and `server`); update both sides
  together when changing an API response shape.
- `hooks/usePolling.ts` — generic polling hook used by every dashboard panel;
  each panel calls it with its own fetcher and interval (5s for
  overview/sessions/blocking, 10s for top queries/wait stats) rather than
  sharing one global refresh loop.
- `App.tsx` — top-level state machine: checks `/api/connection/status` on
  mount, then renders either `ConnectionForm` or the dashboard panels
  (`Overview`, `BlockingChain`, `TopQueriesTable`, `ActiveSessionsTable`,
  `WaitStatsTable`) once connected.
- Styling is a single hand-written `styles.css` (no CSS framework/CSS-in-JS).
