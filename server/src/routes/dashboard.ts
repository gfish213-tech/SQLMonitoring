import { Router, Request, Response, NextFunction } from "express";
import { isConnected } from "../db";
import { getOverview } from "../sql/overview";
import { getBlockingChains } from "../sql/blocking";
import { getLongRunningOps } from "../sql/longOps";
import { getRunningAgentJobs } from "../sql/agentJobs";
import { getCurrentConsumers } from "../sql/consumers";
import { getCurrentWaits } from "../sql/currentWaits";
import { getPressureStats } from "../sql/pressure";
import { getTempdbStats } from "../sql/tempdb";
import { getLogSpaceUsage, getVlfCounts } from "../sql/logSpace";
import { getIoLatency } from "../sql/ioLatency";
import { getRecentAutogrowthEvents } from "../sql/autogrowth";
import { getRecentDeadlocks } from "../sql/deadlocks";
import { getVolumeSpace } from "../sql/volumeSpace";
import { getIndexStats } from "../sql/indexStats";
import { getQueryStoreRegressions } from "../sql/queryStoreRegressions";

const router = Router();

function requireConnection(_req: Request, res: Response, next: NextFunction) {
  if (!isConnected()) {
    res.status(409).json({ error: "Not connected to a database. Connect first." });
    return;
  }
  next();
}

router.use(requireConnection);

// Single combined endpoint: the whole point is a manual "Refresh" click (or an explicit
// auto-refresh opt-in) fetches everything in one request rather than many independent polling
// loops hammering an already-struggling server.
// Labels each panel query so a failure names the panel it came from — a bare Promise.all
// rejection here otherwise surfaces as a generic message with no clue which query actually
// failed.
function labeled<T>(panel: string, promise: Promise<T>): Promise<T> {
  return promise.catch((err) => {
    throw new Error(`[${panel}] ${(err as Error).message}`);
  });
}

// Same wrapping as labeled(), but also streams a progress line the instant this one query
// resolves — independent of when the rest of its Promise.all batch finishes — so the client can
// show which specific check a slow refresh is stuck on instead of one opaque spinner for the
// whole multi-second batch. Doesn't change what runs when or how many queries run concurrently;
// it only reports on the exact same Promise.all structure that was already there.
function tracked<T>(emit: (event: Record<string, unknown>) => void, panel: string, promise: Promise<T>): Promise<T> {
  const startedAt = Date.now();
  return promise.then(
    (value) => {
      emit({ type: "progress", panel, ok: true, ms: Date.now() - startedAt });
      return value;
    },
    (err) => {
      emit({ type: "progress", panel, ok: false, ms: Date.now() - startedAt });
      throw new Error(`[${panel}] ${(err as Error).message}`);
    }
  );
}

// "quick" runs only small, single-pass queries against bounded system DMVs (session/request
// counts, wait lists, msdb job tables, DBCC SQLPERF) — the checks a DBA wants first, and cheap
// enough to run against a server that's already struggling. Consumers lives here too, not in
// "full": despite the OUTER APPLYs to per-session tempdb usage and memory grants, it's still
// keyed off sys.dm_exec_requests, which only has a row per *currently executing* request — the
// same naturally-bounded-by-active-work shape as blocking.ts/currentWaits.ts, not a real scan —
// and "who's using the CPU/memory/IO right now" is a core answer to "why is the server slow,"
// exactly what a quick check should be able to say without needing the heavier checks below.
// "full" adds everything else with a larger scan surface: full per-file DMV scans done twice (IO
// Latency), real OS-level syscalls per file (Volume Space), XML shredding (Deadlocks), a trace
// file read off disk (Autogrowth) — exactly the kind of extra load this tool must not add
// uninvited, but still bounded to a few seconds even on a large server. Index Stats is
// deliberately excluded from both: its per-row scalar function call across every index-usage row
// on the server (see indexStats.ts) was, in practice, the one check slow enough on a
// many-database server to make a DBA wait on a whole Full Refresh just to see panels that were
// long since ready — it's only ever fetched via its own tab's "↻ Refresh Indexes" button
// (PANEL_FETCHERS.indexes below), never automatically. Defaults to "full" for direct API callers;
// the client always passes an explicit mode.
// Streamed as newline-delimited JSON rather than one final res.json(): a Full Refresh can take
// several seconds (IO Latency and Autogrowth especially have real scan/IO cost), and a single
// opaque "Refreshing..." spinner for the whole thing gives a DBA no way to tell whether it's
// almost done or stuck on one specific slow check. Each `tracked()` query writes its
// own {type:"progress"} line the moment it personally finishes; a final {type:"done", data:...}
// line carries the same combined payload this endpoint used to return in one shot. The client
// (useTriage.ts) reads this as a stream and shows live per-check status; older/simpler callers can
// still just read the whole response and parse out the last line.
router.get("/triage", async (req, res) => {
  const quick = req.query.mode === "quick";

  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();
  // Promise.all rejects as soon as the first query fails, but the other queries in that same
  // batch are still genuinely running server-side (rejecting the combined promise doesn't cancel
  // them) - they'll each still call emit() when they eventually settle, which without this guard
  // would try to res.write() on a response the catch block below already res.end()'d, throwing.
  let ended = false;
  function emit(event: Record<string, unknown>) {
    if (ended) return;
    res.write(JSON.stringify(event) + "\n");
  }
  function finish() {
    if (ended) return;
    ended = true;
    res.end();
  }

  try {
    const [overview, blocking, longOps, agentJobs, waits, pressure, logSpace, consumers] = await Promise.all([
      tracked(emit, "overview", getOverview()),
      tracked(emit, "blocking", getBlockingChains()),
      tracked(emit, "longOps", getLongRunningOps()),
      tracked(emit, "agentJobs", getRunningAgentJobs()),
      tracked(emit, "waits", getCurrentWaits()),
      tracked(emit, "pressure", getPressureStats()),
      tracked(emit, "logSpace", getLogSpaceUsage()),
      tracked(emit, "consumers", getCurrentConsumers()),
    ]);

    if (quick) {
      emit({ type: "done", data: { overview, blocking, longOps, agentJobs, waits, pressure, logSpace, consumers } });
      finish();
      return;
    }

    const [tempdb, vlfCounts, ioLatency, autogrowth, deadlocks, volumeSpace, queryStoreRegressions] = await Promise.all([
      tracked(emit, "tempdb", getTempdbStats()),
      tracked(emit, "vlfCounts", getVlfCounts()),
      tracked(emit, "ioLatency", getIoLatency()),
      tracked(emit, "autogrowth", getRecentAutogrowthEvents()),
      tracked(emit, "deadlocks", getRecentDeadlocks()),
      tracked(emit, "volumeSpace", getVolumeSpace()),
      tracked(emit, "queryStoreRegressions", getQueryStoreRegressions()),
    ]);

    emit({
      type: "done",
      data: {
        overview,
        blocking,
        longOps,
        agentJobs,
        waits,
        pressure,
        logSpace,
        consumers,
        tempdb,
        vlfCounts,
        ioLatency,
        autogrowth,
        deadlocks,
        volumeSpace,
        queryStoreRegressions,
      },
    });
    finish();
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
    finish();
  }
});

// Per-tab refresh: re-run just the query (or two) behind one tab instead of the whole quick/full
// batch, for a DBA watching one specific panel (e.g. Consumers while a query finishes) who
// doesn't want a Quick/Full Refresh's full cost just to update the one thing they're looking at
// — strictly less load than either of those, not a new polling loop. Keyed by the same tab names
// the client already uses (DashboardTab in types.ts); each handler returns only the field(s) that
// tab owns, which the client merges into its existing snapshot rather than replacing it.
const PANEL_FETCHERS: Record<string, () => Promise<Record<string, unknown>>> = {
  overview: async () => {
    const [overview, pressure, tempdb, volumeSpace] = await Promise.all([
      labeled("overview", getOverview()),
      labeled("pressure", getPressureStats()),
      labeled("tempdb", getTempdbStats()),
      labeled("volumeSpace", getVolumeSpace()),
    ]);
    return { overview, pressure, tempdb, volumeSpace };
  },
  blocking: async () => ({ blocking: await labeled("blocking", getBlockingChains()) }),
  consumers: async () => ({ consumers: await labeled("consumers", getCurrentConsumers()) }),
  longops: async () => ({ longOps: await labeled("longOps", getLongRunningOps()) }),
  agentjobs: async () => ({ agentJobs: await labeled("agentJobs", getRunningAgentJobs()) }),
  waits: async () => ({ waits: await labeled("waits", getCurrentWaits()) }),
  logspace: async () => {
    const [logSpace, vlfCounts] = await Promise.all([labeled("logSpace", getLogSpaceUsage()), labeled("vlfCounts", getVlfCounts())]);
    return { logSpace, vlfCounts };
  },
  iolatency: async () => ({ ioLatency: await labeled("ioLatency", getIoLatency()) }),
  autogrowth: async () => ({ autogrowth: await labeled("autogrowth", getRecentAutogrowthEvents()) }),
  deadlocks: async () => ({ deadlocks: await labeled("deadlocks", getRecentDeadlocks()) }),
  querystore: async () => ({ queryStoreRegressions: await labeled("queryStoreRegressions", getQueryStoreRegressions()) }),
  indexes: async () => ({ indexStats: await labeled("indexStats", getIndexStats()) }),
};

router.get("/triage/panel/:tab", async (req, res) => {
  const fetcher = PANEL_FETCHERS[req.params.tab];
  if (!fetcher) {
    res.status(404).json({ error: `Unknown panel "${req.params.tab}"` });
    return;
  }

  try {
    res.json(await fetcher());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
