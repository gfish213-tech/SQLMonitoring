# Version History

## 1.5.0 — 2026-07-08

### Added
- **Live per-check progress during Quick/Full Refresh**: a Full Refresh
  used to just show "Refreshing..." for however many seconds the whole
  batch took, with no way to tell whether it was almost done or stuck on
  one specific slow check. `GET /api/triage` now streams a progress line
  the instant each individual query finishes (not when its whole batch
  does), and the refresh bar shows a live checklist — e.g. "13/15 checks
  done" with pill chips per check (Overview ✓ 0.3s, Blocking ✓ 0.1s,
  Index Stats … 5.6s) — so a still-climbing elapsed time on one chip
  while everything else has a checkmark is a direct answer to "which
  part is taking so long," instead of a guess. Doesn't change what runs
  when or how many queries run concurrently — same two-phase batch
  structure as before, just observed from outside.
- **Wait type tooltips**: raw wait type names like `PAGEIOLATCH_SH` or
  `LCK_M_X` now show a plain-English explanation on hover (dotted
  underline, native tooltip) wherever they appear — Waits, Top Resource
  Consumers, and Blocking. Covers the wait types that actually show up in
  this app's own diagnosis thresholds and everyday incidents by exact
  name (`CXPACKET`, `WRITELOG`, `THREADPOOL`, `RESOURCE_SEMAPHORE`,
  `ASYNC_NETWORK_IO`, etc.), falls back to a family-level explanation by
  prefix (`LCK_M_*` → lock waits, `PAGEIOLATCH_*`/`PAGELATCH_*` → disk vs.
  in-memory page contention, `PREEMPTIVE_*`, `HADR_*`, etc.) for anything
  more specific, and a generic "not one of the common ones" note for
  anything still unrecognized rather than leaving it unexplained.
- **Server picker sorted Development → Staging → Production, and remembers
  your last server**: the dropdown on the connect screen no longer follows
  `servers.json`'s raw order — it's grouped Development first, then
  Staging, then Production last (anything else, e.g. a deprecated server,
  sorts after Production), alphabetically by label within each group.
  Development is also what's pre-selected on load, so the default pick is
  the lowest-stakes one rather than whatever happened to be listed first
  in the config file — unless you've connected to a server before, in
  which case that one (remembered in the browser via `localStorage`) is
  pre-selected instead, so monitoring the same server every day doesn't
  mean reselecting it every time.
- **Diagnosis banner no longer repeats on every tab**: it now renders only
  on the Overview tab instead of staying pinned above whatever tab you've
  switched to — its "View details →" jump buttons still work the same way
  from there, you just don't see the banner itself again once you've
  navigated to, say, Blocking or Consumers.
- **Copy for AI row/graph caps**, as a backstop alongside the query-text
  fix below: since Top Resource Consumers now returns every active
  request uncapped, and deadlock XML can be individually huge, a real
  production snapshot could still get long even with query text fixed.
  Consumers is capped to the top 25 (already CPU-sorted from the server),
  blocked sessions per lead blocker to 15, and deadlock graphs to the 3
  most recent — each cap adds a "... and N more, see the X tab" line
  rather than silently dropping data. The on-screen tables themselves are
  unaffected; only the AI-facing text is trimmed.
- **`start.bat` checks prerequisites upfront**: Git, Node.js, and npm are
  verified on `PATH` before anything else runs, failing fast with a
  specific, named message and a download link if one is missing — a
  missing tool previously only surfaced as whatever raw, often cryptic
  error `npm`/`node-gyp` happened to print, wrapped in a generic
  "install failed". A best-effort, non-fatal registry check also warns
  if neither "ODBC Driver 17" nor "18 for SQL Server" can be found
  (this one doesn't stop the script — the app's own Connect/Test
  Connection error is already clear if this check has a false negative).
  If `npm install` itself still fails, the error message now names the
  most common cause (a missing C++ build toolchain or Python, both
  required by node-gyp to compile the native driver) instead of just
  pointing at the scrollback above it.
- **Per-tab refresh**: a "↻ Refresh &lt;Tab&gt;" button now sits above every
  tab's content and re-runs only that tab's query — one query (or two, for
  Overview and Log Space), strictly less load than even Quick Refresh's
  seven. Useful for watching one specific panel (e.g. Consumers while a
  query finishes) without paying for a whole batch, and doubles as a way
  to populate a single full-only tab without running a full Full Refresh.
  Merges into the existing snapshot, so every other tab's data is left
  untouched, and shows its own "panel refreshed HH:MM:SS" timestamp
  separate from the main "Last updated" time.
- **Sortable, filterable, uncapped Top Resource Consumers**: click any
  resource column header (CPU, Elapsed, Logical/Physical Reads, Writes,
  TempDB, Memory Grant) to sort by it, click again to reverse — free
  re-ordering of already-fetched rows, no new query. The underlying query
  itself also changed: it used to be a flat "top 20 by CPU," which meant a
  session that was IO- or memory-heavy but not CPU-heavy would never even
  be fetched, so no amount of client-side sorting could surface it. Rather
  than trying to predict server-side which rows might matter (an
  intermediate version ranked CPU/reads/writes/memory separately and
  unioned each ranking's top rows), the query now simply returns every
  currently active request with **no cap at all** — `sys.dm_exec_requests`
  only has a row per request that's actually executing right now, so the
  result is already naturally small, and sorting/filtering client-side has
  zero risk of missing a genuine top consumer. A "Hide 'sa' session"
  checkbox (**on** by default — `sa` is almost always maintenance/
  monitoring noise, not the cause; uncheck it to see everything) filters
  out that login client-side.
- **Physical disk reads and memory grants in Top Resource Consumers**: the
  Consumers panel already showed CPU, elapsed time, logical reads, and the
  live query text per session — now it also shows `physicalReads` (real
  disk reads, from `sys.dm_exec_requests.reads`) alongside the existing
  logical reads (buffer-pool touches, which can be cache hits and don't
  necessarily mean disk activity), and a Memory Grant column from `sys.
  dm_exec_query_memory_grants` showing either the amount a session is
  currently holding or, if it's queued waiting on one, "waiting for N MB"
  in a distinct warning color. Together with the existing CPU/query-text
  columns this makes Consumers a single place to see who's driving CPU,
  memory, and disk I/O right now, with the exact command each is running.
  Most sessions don't hold a memory grant at all (only sorts/hashes/large
  joins need one) — a "-" there is expected, not a bug.

### Fixed
- **A fixed disk latency problem kept reading as an active critical
  finding indefinitely**: the diagnosis flags the worse of a file's
  since-restart average latency or its 1-second-delta current reading —
  correct for catching a live spike the average hasn't caught up to yet,
  but the reverse case wasn't handled: once the actual problem is fixed,
  the average stays elevated (it only resets on a SQL Server restart)
  even though the live reading is now healthy, so the finding never
  cleared no matter how long the fix had been in place. Now, when the
  average is what's driving severity but the current 1-second sample
  genuinely saw I/O and came back healthy (≤15ms), the finding downgrades
  to `info` with a "(currently healthy)" title suffix and detail text
  explaining the average won't drop until the next restart — instead of
  disappearing outright (a single lucky sample could still be
  coincidence) or continuing to read as an unresolved critical.
- **Table headers didn't line up with their numeric columns**: every
  numeric column right-aligns its data (`.num`, so figures line up
  vertically), but the header cell above it was left-aligned by default,
  so a column like CPU or Elapsed had its numbers sitting under the right
  edge of a header label anchored to the left — every numeric column in
  every table (Consumers, Blocking, Waits, Agent Jobs, TempDB, Disk
  Volume Space, Log Space/VLF Count, Autogrowth, Index Stats) had this
  mismatch. Fixed by marking each numeric column's `<th>` with the same
  `.num` class as its `<td>`s (plus a matching rule for Consumers'
  clickable sort-button headers), so header and data now share the same
  right edge.
- **Current Waits was flooded with SQL Server's own background waits**:
  the panel's "excludes benign background waits" badge was only
  half-true — the exclusion list named a handful of wait types by hand,
  but SQL Server has dozens of internal background wait types (Hekaton/
  XTP, HADR, full-text, Service Broker, checkpoint, lazy writer, and
  more added every version), so most of them slipped through and
  drowned out anything a real incident would show — rows like
  `WAIT_XTP_HOST_WAIT`, `PVS_PREALLOCATE`, `FT_IFTSHC_MUTEX`,
  `HADR_NOTIFICATION_DEQUEUE`, `BROKER_TRANSMITTER`, `KSOURCE_WAKEUP`,
  `ONDEMAND_TASK_QUEUE`, `CHECKPOINT_QUEUE`, `XE_TIMER_EVENT`, and
  `DIRTY_PAGE_POLL`, all permanently "waiting" for days since the
  server last restarted. Fixed at the root: every one of those belongs
  to a SQL Server system worker task, not a user request, so
  `currentWaits.ts` now joins `sys.dm_exec_sessions` and filters
  `is_user_process = 1` to exclude the whole category at once instead
  of trying to keep a hand-written list current. The existing name-based
  exclusions (now also including `WAITFOR`, since a real user session
  running this app's own Overview/Pressure 1-second sampling would
  otherwise show up as "waiting on itself") remain as a second layer for
  the few benign waits a genuine user session can still generate.
- **"Query text" was dumping entire stored procedure bodies**: the real
  cause behind Copy for AI's 6,000-line problem, not just row counts.
  `sys.dm_exec_sql_text(sql_handle)` returns the *entire* batch or stored
  procedure body for a handle, not just the statement actually executing —
  so a session running inside even a modest stored procedure reported
  that procedure's whole (often hundreds-of-lines) source as its "query,"
  in Consumers, Blocking, and Backups/Long-Running Operations alike. Fixed
  at the source (`sql/statementText.ts`, shared by all three): when the
  batch is running inside a procedure, show `EXEC dbo.ProcName` instead of
  the body; for ad-hoc SQL, slice out just the one currently-executing
  statement (`SUBSTRING` at `[statement_start_offset,
  statement_end_offset)`, the standard idiom) instead of the whole
  (possibly multi-statement) batch text. The character-count truncation
  added alongside this is now mostly a backstop for a single huge ad-hoc
  statement, not the primary defense.
- **Full Refresh could fail entirely with "Query timeout expired"**: the
  Index Stats check called `OBJECT_NAME(id, dbid)` — a genuinely slow
  cross-database metadata lookup — in a `WHERE` clause against every raw
  row of `sys.dm_db_index_usage_stats`, before any cheap numeric filtering
  happened. On a server with many databases/objects this could exceed the
  15s query timeout, and unlike `autogrowth.ts`/`deadlocks.ts` it wasn't
  wrapped to fail soft, so the timeout took down the *entire* Full
  Refresh — losing every other panel's data along with it, not just Index
  Stats. Fixed both ways: the query now filters on plain numeric columns
  first and resolves each table name exactly once (`CROSS APPLY`) only for
  the much smaller set of rows that survive filtering, and the whole check
  is now wrapped in `try`/`catch` → empty results, matching the same
  fail-soft pattern already used for the trace-/extended-events-based
  checks, so one slow panel can no longer sink the rest of a refresh.
- **Current Waits could be dominated by one session's parallel worker
  threads**: `sys.dm_os_waiting_tasks` has one row per *task*, and a
  parallel query has one worker thread per degree of parallelism, so a
  single session running an 8-way parallel query could show up as 8+
  near-identical rows (same session, same wait type, same wait duration,
  differing only in an internal exchange/pipe id) — burying every other
  session's waits underneath it. `currentWaits.ts` now groups by
  (session, wait type), reporting a task count instead of one row per
  task; the Waits tab shows the count in a new "Tasks" column, and Copy
  for AI notes it inline ("across 8 parallel tasks").

### Changed
- **Copy for AI no longer includes this app's own "Suggested action"
  advice text**: the plain-text snapshot is meant to be pasted into an
  actual AI chat, which can reason about the raw facts (what's wrong, on
  what, since when) and formulate its own recommendation — repeating
  this app's canned advice paragraph, once per finding, was pure token
  waste on real production snapshots with many similar findings (e.g.
  a dozen VLF-fragmented databases, each repeating the identical
  paragraph about DBCC SHRINKFILE). The on-screen "What to do" advice
  boxes (`DiagnosisSummary.tsx`) are unaffected — this only trims the
  copy-to-clipboard text.
- **On-screen diagnosis list groups repeated advice instead of repeating
  it per finding**: the same redundancy as above, but on screen — the
  "N other potential factors" list showed a full "💡 What to do" box
  under *every* finding, so a dozen+ VLF-fragmented databases or hot IO
  files meant a dozen+ near-identical advice boxes stacked in a row.
  Consecutive findings that share the exact same advice text now group
  under one shared box (e.g. "VLF count (3 items):" followed by each
  database's specific line, then one "Suggested action" box) — each
  finding's own specifics stay visible, only the repeated paragraph
  collapses. Findings with different severity never merge even if their
  advice text matches, since they're not adjacent after the severity
  sort. Within a group, the `detail` sentence collapses too, two ways:
  when it's the literal same string for every member (VLF count's is
  pure boilerplate with no per-database content — a 12-database group
  used to repeat that same sentence 12 times for zero new information
  each time), the whole sentence shows once and each item shows just its
  title; otherwise, since every `detail` is built as `<unique part> —
  <fixed sentence>` (disk latency: file path — "normal is under
  ~15ms..."; autogrowth: "Took Xms at HH:MM:SS" — "can cause a brief
  freeze..."), if the part *after* that first "—" is identical across
  the whole group, that fixed sentence shows once and each item keeps
  just its own unique file path or duration/timestamp — real
  per-finding data never collapses, only the fixed sentence attached to
  it. Falls back to showing `detail` in full per item when neither
  condition holds (e.g. a mix of flagged/unflagged disk-latency findings
  in one group, whose trailing "Worse right now..." clause differs).

## 1.4.0 — 2026-07-07

### Added
- **Manual light/dark theme toggle**: a small sun/moon button (top-right,
  present on the connect screen and the dashboard alike) switches themes
  on demand and remembers the choice in the browser (`localStorage`), no
  longer relying solely on the OS/browser's reported color-scheme
  preference. The stored choice applies before first paint, so it never
  flashes the other theme on load.

### Changed
- **Redesigned the interface on a validated color system**: replaced the
  ad hoc slate-blue dark theme with a proper light/dark palette (the app
  previously had `color-scheme: light dark` declared but no actual light
  values — every color was a hardcoded dark hex). Status meaning is now
  consistent everywhere: a fixed, CVD-validated critical/warning/good
  triple (plus a "serious" step for tab dots, kept visually distinct from
  the diagnosis banner's own critical/warning so the tab strip doesn't
  compete with it) drives the diagnosis banner, stat card borders, env
  badges, and table row flags — previously these each had their own
  slightly different reds/oranges/greens. Numeric table columns (session
  IDs, CPU/reads/writes, MB, percentages) now use `tabular-nums` and
  right-alignment so figures line up vertically instead of ragged-left
  text. Progress meters (backup/restore % complete) now show the fill on
  a tinted track of the same hue rather than a plain dark box. Dark stays
  the default appearance; light now actually renders correctly for anyone
  whose OS reports a light color-scheme preference.

## 1.3.0 — 2026-07-06

A single day's worth of work turning the 1.2.0 triage rework into a more
complete incident-response tool: two-weight refresh, actionable advice on
every finding, several new diagnostic panels, and a tabbed layout.

### Added
- **"What to do" advice on every diagnosis finding**: each detected cause
  now carries a concrete first-response action written for mid-incident use
  — e.g. an idle-with-open-transaction blocker says who to contact and that
  `KILL <spid>` releases the chain (and what rolls back); a full transaction
  log says to check `log_reuse_wait_desc` and take a **log backup**, not a
  shrink; a rollback in progress says explicitly *not* to kill it; worker
  thread exhaustion points at blocking as the usual root cause rather than
  raising `max worker threads`. Shown as a 💡 highlighted box under the top
  finding and under each item in the "other potential factors" list, and
  included as "Suggested action" lines in the **Copy for AI** text.
- **Two refresh modes — Quick Refresh and Full Refresh**: refreshing a
  server that's already struggling shouldn't itself add a heavy batch of
  queries. `GET /api/triage?mode=quick` (used on page load, the new **Quick
  Refresh** button, and auto-refresh) now runs only the small, single-pass
  checks — Overview, Blocking, Backups/Long Ops, Agent Jobs, Waits,
  Pressure, Log Space. **Full Refresh** additionally runs the heavier
  checks with a larger scan surface — Consumers, TempDB, VLF Counts, IO
  Latency, Autogrowth, Deadlocks, Disk Volume Space, Indexes. Tabs and
  sections that weren't checked in a quick refresh show a dashed "not
  checked — run Full Refresh" placeholder instead of an empty state, and
  their tab dot is dim gray rather than red/none, so "not checked yet" is
  never confused with "checked, nothing found." The diagnosis banner and
  Copy for AI text both call this out explicitly on a quick-only snapshot.
- **Current (1-second-delta) I/O latency, IOPS, and throughput** alongside
  the existing since-restart average in Disk / IO Latency: the average
  alone is diluted by however long the server's been up, so a file that
  started stalling minutes ago barely moves a lifetime average on a
  server that's been up for months. A file is now flagged if *either*
  figure is elevated, and the diagnosis banner says so explicitly when the
  current reading — not the average — is what crossed the threshold.
- **Disk Volume Space** panel (Overview tab): every OS volume hosting a
  SQL Server file, with free space/%, via `sys.dm_os_volume_stats` — no
  more remoting in to check Windows Explorer for free space. Flagged in
  the diagnosis banner under 15%/5% free.
- **Plan cache / ad-hoc query stats** (Overview tab): total plan cache
  size, the share that's ad-hoc (unparameterized SQL, as opposed to
  stored procs/`sp_executesql`), and single-use ad-hoc plan count/size —
  plan cache pollution competes with the buffer pool for memory and can
  drag down Page Life Expectancy. Flagged when ad-hoc share is over 50%
  and single-use plans exceed 256 MB.
- **Worker thread / scheduler exhaustion** (Overview tab, CPU & Memory
  Pressure): `runnable_tasks_count` (tasks ready to run but waiting for a
  free CPU core — true scheduler pressure, no sampling delay needed) and
  `work_queue_count` (SQL Server has run out of worker threads entirely —
  always a critical finding when non-zero) from `sys.dm_os_schedulers`.
- **VLF (virtual log file) counts** (Log Space tab): flags any database
  with over 100 VLFs via `sys.dm_db_log_info` (SQL Server 2017+) — a
  heavily fragmented log slows down recovery/failover and log-heavy
  writes, independently of how full the log currently is.
- **Index usage stats** (new Indexes tab): "Top Tables by Scans" (a high
  scan count relative to seeks can mean a missing index) and "Unused
  Indexes" (written to but never read — pure write overhead) from
  `sys.dm_db_index_usage_stats`. Shows `index_id` rather than a resolved
  index name — cross-database index name resolution needs per-database
  dynamic SQL, which this app avoids for reliability; table names still
  resolve correctly cross-database via `OBJECT_NAME(id, db_id)`.
- **Committed `allowScripts` approval** in `server/package.json` (for
  `msnodesqlv8@5.2.1` and `esbuild@0.28.1`) and `client/package.json` (for
  `esbuild@0.25.12`). Some environments (e.g. a corporate npm policy) gate
  install scripts behind an approval step; without it, `msnodesqlv8`'s
  `node-gyp rebuild` install script never runs, so the native SQL Server
  driver never compiles and every Connect/Test Connection attempt fails
  with "native msnodesqlv8 driver is not built on this host" even though
  `npm install` itself reported no errors. Committing the approval means a
  fresh clone doesn't need any manual step. `start.bat` also best-effort
  runs `npm approve-scripts msnodesqlv8` / `npm approve-scripts esbuild`
  before installing, as a fallback for when a dependency bump changes the
  resolved version and the committed approval goes stale. (An earlier
  attempt used `npm approve-scripts --allow-scripts-pending`, which just
  re-lists pending scripts instead of approving them — approval is
  per-package **and per-version** by name.)
- **Explanatory tooltips and panel badges** so a number or an empty panel
  isn't misread: a small "ⓘ" hint on stats whose meaning isn't obvious from
  the value alone (e.g. that Signal Wait % / Buffer Cache Hit Ratio /
  Batch Requests/sec are a 1-second sample; that TempDB Used includes the
  version store; that Version Store always reads 0 before 2016 SP2), and a
  persistent header badge on panels with a filtering rule that otherwise
  only shows up in the empty-state text (e.g. "top 20 by CPU time", "last
  24 hours", "excludes benign background waits", "only databases over 50%
  log used"). The Copy for AI text carries the same caveats inline in each
  section heading.
- **Tabbed layout** replaces the single long scrolling page: only the
  Diagnosis banner and the sticky Refresh bar/tab strip are always
  visible; everything else — Overview (with Pressure & TempDB), Blocking,
  Consumers, Backups, Agent Jobs, Waits, Log Space, IO Latency, Autogrowth,
  Deadlocks — is one tab each, shown one at a time. Every tab with actual
  data gets a small red dot so it's obvious at a glance which tabs are
  worth checking without clicking through all of them. The diagnosis
  banner's top finding (and each item in "N other potential factors") now
  has a **View details →** button that jumps straight to the relevant tab.
- **Diagnosis banner**: a summary at the top of the dashboard that scores
  all 12 panels against fixed thresholds and states the single most likely
  cause in plain language (e.g. "Most likely cause: Blocking — Session 82
  is blocking 2 other sessions"), with any other factors that crossed a
  threshold in a collapsed "N other potential factors" list, or a plain "no
  obvious cause detected" state if nothing did. Answers "which of the usual
  suspects is it" directly instead of requiring a manual scan of all 11
  panels.
- `start.bat` at the repo root: a double-click launcher for end users who
  don't want to touch a terminal. Force-syncs the local checkout to the
  branch all fixes are pushed to (fixing a "no tracking information for
  the current branch" failure when the local clone was sitting on
  `master`), auto-stashing and restoring any local tracked edits (like a
  user's own additions to `server/config/servers.json`) around the
  switch/pull, installs dependencies, runs `npm run serve` (build + start)
  in its own window, polls `localhost:4000` until the server responds, then
  opens it in the default browser automatically.
- `start.bat` is now self-bootstrapping: if handed to someone as a
  standalone file with no project next to it, it clones the repo into a
  `SQLMonitoring` subfolder first, then continues as normal — so sharing
  just this one file (plus the usual prerequisites: Git, Node.js, the C++
  build toolchain, and the ODBC driver) is enough to set up a new machine.
- **Copy for AI** button in the refresh bar: copies the entire snapshot
  (diagnosis findings plus every panel's data, spelled out as plain text)
  to the clipboard in one click, ready to paste into an AI chat for a
  second opinion or help interpreting something unfamiliar.

### Fixed
- **TempDB "Used" showed `null MB`**: the query read tempdb's file names
  from `tempdb.sys.database_files` but then called `FILEPROPERTY(name,
  'SpaceUsed')`, which evaluates against whatever database the connection
  is *currently* in (this app defaults to `master`), not the database
  implied by the table it's reading from — no file in `master` matched
  those names, so it silently returned `NULL` for every row. Replaced with
  `tempdb.sys.dm_db_file_space_usage`, which is genuinely queryable via a
  3-part name from any database, and which also gives a proper breakdown
  into **User Objects**, **Internal Objects**, and **Version Store**
  instead of one opaque "Used" number.
- **"Batch Requests/sec" and "Buffer Cache Hit Ratio" showed lifetime
  totals, not current values**: both come from cumulative-since-restart
  performance counters, so on a real server "Batch Requests/sec" would have
  displayed the total number of batches ever executed (billions). Both are
  now computed as a 1-second delta (two samples with a `WAITFOR DELAY`
  between), so they show what the last second actually looked like. A
  refresh now deliberately takes about a second.
- **Signal Wait % (CPU pressure) was also cumulative since restart** — on a
  server up for months a live CPU storm barely moved it, and old history
  could keep it permanently elevated, making the diagnosis banner's "CPU
  pressure" finding unreliable in both directions. Now a 1-second delta
  over `sys.dm_os_wait_stats` with the standard benign background waits
  excluded.
- **Blocking chains dropped indirect victims**: in a chain A←B←C, session C
  (waiting on B, which waits on A) was silently omitted from A's blocked
  list, understating "blocking N sessions" during a real blocking storm.
  The full transitive chain is now collected, and a new "Waiting On" column
  shows each victim's direct blocker so the chain structure is visible.
- Top Resource Consumers is now capped at 20 rows (was unbounded — a server
  with hundreds of active requests would have rendered them all).
- Unknown `/api/*` paths now return a JSON 404 instead of falling through
  to the SPA catch-all and returning the app's HTML with a 200; the client's
  `request()` helper also no longer surfaces a raw `JSON.parse` error when a
  proxy or mid-restart server returns non-JSON.
- Diagnosis banner's CPU finding no longer reads "CPU pressure: CPU
  pressure: …".
- The Disk/IO Latency panel (and the corresponding section of the Copy for
  AI text) is now labeled "averaged since SQL Server restart" — that DMV is
  cumulative, and a 1-second sample would be too noisy for quiet files, so
  the caveat is stated instead of leaving the number to read as live.
- `consumers.ts`'s per-session tempdb calculation had a paren mismatch that
  put the `* 8.0 / 1024` cast math inside `SUM(...)`'s own argument list,
  which made SQL Server parse it as a call to a nonexistent table function
  and fail with `'SUM' is not a recognized built-in function name`.
- `/api/triage` now labels each panel's query (e.g. `[consumers] ...`) on
  failure, so a bad query names itself instead of surfacing a bare,
  unattributed error.
- `start.bat`'s "stash local changes" step relied on `git diff --quiet HEAD`
  to predict whether anything needed stashing, which can false-positive on
  Windows (e.g. CRLF normalization) and lead to a `git stash push` that
  saves nothing, followed by a `git stash pop` that fails with "No stash
  entries found". It now checks whether a stash was actually created
  (comparing the stash ref before/after) instead of predicting it, and uses
  delayed expansion throughout so variables set inside a parenthesized
  block are read correctly.

### Changed
- **Dashboard re-layout** to cut down on scrolling and give panels with
  actual data more visual priority: vitals (Overview, Pressure, TempDB) stay
  compact and fixed at the top; Blocking and Consumers (the two widest,
  most information-dense tables) stay full-width right below; the
  remaining 7 reference panels (Backups, Agent Jobs, Waits, Log Space, I/O
  Latency, Autogrowth, Deadlocks) now flow into a 2-column layout sorted so
  panels with data float above the quiet "nothing to report" ones, instead
  of all 11 panels stacking full-width in a single fixed vertical order
  regardless of which ones actually have something to show.

## 1.2.0 — 2026-07-06

Reworked into a live incident-triage tool ("why is the DB slow right now?")
instead of a general trend dashboard — DBADash already covers daily/trend
monitoring, so this tool now only shows current state.

### Fixed
- `mssql`'s `msnodesqlv8` connection-string builder hardcoded the deprecated
  "SQL Server Native Client 11.0" ODBC driver on Windows and never wired up
  `TrustServerCertificate` at all. The app now builds its own ODBC connection
  string and probes installed drivers in order (18 → 17 → Native Client 11),
  remembering whichever one works.
- The native driver reports errors as plain objects (or arrays of them), not
  `Error` instances, which is why failures previously showed as
  `[object Object]`. Real diagnostic text (message + SQLSTATE) is now
  extracted and surfaced.

### Changed
- **Single-command run**: the Express server now serves the built React app
  as static files alongside the API on one port. A new root-level
  `package.json` adds `install:all`/`build`/`start`/`serve` so the whole app
  runs from one command instead of two separate dev servers.
- **Server picker replaces the connection form**: no more manual
  server/port/instance entry. `server/config/servers.json` holds a hardcoded,
  editable list of servers with environment labels (color-coded badge:
  Production/Staging/Development/deprecated); picking one and clicking
  Connect does the rest.
- **Manual refresh by default**: removed the always-on 5-10s polling. A
  single **Refresh** button re-fetches everything in one combined request;
  an explicit **Auto-refresh every 20s** checkbox opts into polling. This
  tool must not add its own query load to a server that may already be
  struggling.
- **Dashboard rebuilt around 11 specific causes of slowness** instead of
  general trend panels: Blocking & Long Transactions (now detects idle
  sessions holding open transactions, not just active blockers), Backups &
  Long-Running Operations, Running Agent Jobs, Top Resource Consumers (Right
  Now), Current Waits, CPU & Memory Pressure, TempDB Contention, Transaction
  Log Space, Disk/IO Latency, Recent Auto-Growth Events, Recent Deadlocks.
- Removed the cumulative-since-restart Top Queries, Wait Stats, and Active
  Sessions panels — that trend data is already covered by DBADash; this tool
  only shows what's happening right now.

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
