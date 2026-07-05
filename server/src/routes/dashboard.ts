import { Router, Request, Response, NextFunction } from "express";
import { isConnected } from "../db";
import { getOverview } from "../sql/overview";
import { getTopQueries, TopQueryMetric } from "../sql/topQueries";
import { getActiveSessions } from "../sql/activeSessions";
import { getBlockingChains } from "../sql/blocking";
import { getTopWaitStats } from "../sql/waitStats";

const router = Router();

function requireConnection(_req: Request, res: Response, next: NextFunction) {
  if (!isConnected()) {
    res.status(409).json({ error: "Not connected to a database. Connect first." });
    return;
  }
  next();
}

router.use(requireConnection);

const VALID_METRICS: TopQueryMetric[] = ["cpu", "duration", "reads", "writes", "executions"];

router.get("/overview", async (_req, res) => {
  try {
    res.json(await getOverview());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/queries/top", async (req, res) => {
  try {
    const metric = (req.query.metric as TopQueryMetric) ?? "cpu";
    if (!VALID_METRICS.includes(metric)) {
      res.status(400).json({ error: `metric must be one of ${VALID_METRICS.join(", ")}` });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 25;
    res.json(await getTopQueries(metric, limit));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/sessions", async (_req, res) => {
  try {
    res.json(await getActiveSessions());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/blocking", async (_req, res) => {
  try {
    res.json(await getBlockingChains());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/waits", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json(await getTopWaitStats(limit));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
