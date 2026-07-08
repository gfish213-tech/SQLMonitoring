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

// "quick" runs only small, single-pass queries against bounded system DMVs (session/request
// counts, wait lists, msdb job tables, DBCC SQLPERF) — the checks a DBA wants first, and cheap
// enough to run against a server that's already struggling. "full" adds everything with a
// larger scan surface: per-row correlated subqueries (Consumers), full per-file DMV scans done
// twice (IO Latency), real OS-level syscalls per file (Volume Space), XML shredding (Deadlocks),
// a trace file read off disk (Autogrowth), and a per-row scalar function call across every
// index-usage row on the server (Index Stats) — exactly the kind of extra load this tool must
// not add uninvited. Defaults to "full" for direct API callers; the client always passes an
// explicit mode.
router.get("/triage", async (req, res) => {
  const quick = req.query.mode === "quick";

  try {
    const [overview, blocking, longOps, agentJobs, waits, pressure, logSpace] = await Promise.all([
      labeled("overview", getOverview()),
      labeled("blocking", getBlockingChains()),
      labeled("longOps", getLongRunningOps()),
      labeled("agentJobs", getRunningAgentJobs()),
      labeled("waits", getCurrentWaits()),
      labeled("pressure", getPressureStats()),
      labeled("logSpace", getLogSpaceUsage()),
    ]);

    if (quick) {
      res.json({ overview, blocking, longOps, agentJobs, waits, pressure, logSpace });
      return;
    }

    const [consumers, tempdb, vlfCounts, ioLatency, autogrowth, deadlocks, volumeSpace, indexStats] = await Promise.all([
      labeled("consumers", getCurrentConsumers()),
      labeled("tempdb", getTempdbStats()),
      labeled("vlfCounts", getVlfCounts()),
      labeled("ioLatency", getIoLatency()),
      labeled("autogrowth", getRecentAutogrowthEvents()),
      labeled("deadlocks", getRecentDeadlocks()),
      labeled("volumeSpace", getVolumeSpace()),
      labeled("indexStats", getIndexStats()),
    ]);

    res.json({
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
      indexStats,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
