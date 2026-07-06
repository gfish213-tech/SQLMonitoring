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
router.get("/triage", async (_req, res) => {
  try {
    const [overview, blocking, longOps, agentJobs, consumers, waits, pressure, tempdb, logSpace, ioLatency, autogrowth, deadlocks] =
      await Promise.all([
        getOverview(),
        getBlockingChains(),
        getLongRunningOps(),
        getRunningAgentJobs(),
        getCurrentConsumers(),
        getCurrentWaits(),
        getPressureStats(),
        getTempdbStats(),
        getLogSpaceUsage(),
        getIoLatency(),
        getRecentAutogrowthEvents(),
        getRecentDeadlocks(),
      ]);

    res.json({ overview, blocking, longOps, agentJobs, consumers, waits, pressure, tempdb, logSpace, ioLatency, autogrowth, deadlocks });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
