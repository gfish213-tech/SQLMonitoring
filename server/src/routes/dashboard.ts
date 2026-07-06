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
import { getLogSpaceUsage } from "../sql/logSpace";
import { getIoLatency } from "../sql/ioLatency";
import { getRecentAutogrowthEvents } from "../sql/autogrowth";
import { getRecentDeadlocks } from "../sql/deadlocks";
import { getVolumeSpace } from "../sql/volumeSpace";

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
// auto-refresh opt-in) fetches everything in one request rather than 11 independent polling
// loops hammering an already-struggling server.
// Labels each panel query so a failure names the panel it came from — a bare Promise.all
// rejection here otherwise surfaces as a generic message with no clue which of the 12 queries
// actually failed.
function labeled<T>(panel: string, promise: Promise<T>): Promise<T> {
  return promise.catch((err) => {
    throw new Error(`[${panel}] ${(err as Error).message}`);
  });
}

router.get("/triage", async (_req, res) => {
  try {
    const [overview, blocking, longOps, agentJobs, consumers, waits, pressure, tempdb, logSpace, ioLatency, autogrowth, deadlocks, volumeSpace] =
      await Promise.all([
        labeled("overview", getOverview()),
        labeled("blocking", getBlockingChains()),
        labeled("longOps", getLongRunningOps()),
        labeled("agentJobs", getRunningAgentJobs()),
        labeled("consumers", getCurrentConsumers()),
        labeled("waits", getCurrentWaits()),
        labeled("pressure", getPressureStats()),
        labeled("tempdb", getTempdbStats()),
        labeled("logSpace", getLogSpaceUsage()),
        labeled("ioLatency", getIoLatency()),
        labeled("autogrowth", getRecentAutogrowthEvents()),
        labeled("deadlocks", getRecentDeadlocks()),
        labeled("volumeSpace", getVolumeSpace()),
      ]);

    res.json({
      overview,
      blocking,
      longOps,
      agentJobs,
      consumers,
      waits,
      pressure,
      tempdb,
      logSpace,
      ioLatency,
      autogrowth,
      deadlocks,
      volumeSpace,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
