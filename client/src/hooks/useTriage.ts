import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DashboardTab, TriageData } from "../types";

const AUTO_REFRESH_INTERVAL_MS = 20000;

// Must match the panel labels dashboard.ts's /triage route emits progress events for, and the
// exact same quick/full split as its two Promise.all batches (see the comment there) - this is
// only used to seed the initial "pending" list before any progress events arrive, so a DBA sees
// the full checklist immediately rather than have items pop in one at a time as they start.
// Index Stats is deliberately not here at all - it's excluded from both Quick and Full Refresh
// (see dashboard.ts's /triage route) since it was the one check slow enough on a many-database
// server to make a DBA wait on a whole Full Refresh just to see panels that were long since
// ready; it's only ever fetched via the Indexes tab's own "↻ Refresh Indexes" button.
const QUICK_PANELS = ["overview", "blocking", "longOps", "agentJobs", "waits", "pressure", "logSpace", "consumers"];
const FULL_ONLY_PANELS = ["tempdb", "vlfCounts", "ioLatency", "autogrowth", "deadlocks", "volumeSpace", "queryStoreRegressions"];
const ALL_PANELS = [...QUICK_PANELS, ...FULL_ONLY_PANELS];

// One entry per check the server tracks for a given refresh - see dashboard.ts's /triage route.
// Shown in the refresh bar so a slow Full Refresh names which specific check it's waiting on
// instead of one opaque spinner for the whole multi-second batch.
export interface RefreshCheckStatus {
  panel: string;
  status: "pending" | "done" | "error";
  ms: number | null;
}

export function useTriage() {
  const [data, setData] = useState<TriageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastMode, setLastMode] = useState<"quick" | "full" | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [panelLoading, setPanelLoading] = useState<DashboardTab | null>(null);
  const [panelUpdatedAt, setPanelUpdatedAt] = useState<Partial<Record<DashboardTab, Date>>>({});
  const [refreshChecks, setRefreshChecks] = useState<RefreshCheckStatus[]>([]);
  const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null);

  const fetchMode = useCallback(async (mode: "quick" | "full") => {
    setLoading(true);
    setRefreshStartedAt(Date.now());
    setRefreshChecks(
      (mode === "quick" ? QUICK_PANELS : ALL_PANELS).map((panel) => ({ panel, status: "pending", ms: null }))
    );
    try {
      const result = await api.triage(mode, (event) => {
        setRefreshChecks((prev) =>
          prev.map((c) => (c.panel === event.panel ? { panel: c.panel, status: event.ok ? "done" : "error", ms: event.ms } : c))
        );
      });
      setData(result);
      setLastMode(mode);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => fetchMode("quick"), [fetchMode]);
  const fullRefresh = useCallback(() => fetchMode("full"), [fetchMode]);

  // Re-runs just the query (or two) behind a single tab, for a DBA watching one specific panel
  // (e.g. Consumers while a query finishes) who doesn't want a whole Quick/Full Refresh just to
  // update the one thing they're looking at - strictly less load than either of those. Merges
  // into the existing snapshot rather than replacing it, so every other tab's data stays put.
  const refreshPanel = useCallback(async (tab: DashboardTab) => {
    setPanelLoading(tab);
    try {
      const partial = await api.refreshPanel(tab);
      setData((prev) => (prev ? { ...prev, ...partial } : prev));
      setPanelUpdatedAt((prev) => ({ ...prev, [tab]: new Date() }));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPanelLoading(null);
    }
  }, []);

  // Fetch once on mount, quick-only. Deliberately no default interval, and auto-refresh below
  // only ever does a quick fetch — this tool exists to check on a server that may already be
  // struggling, so it must not add its own background query load, and a "quick" check already
  // covers the small/cheap DMVs; the heavier ones (full per-file scans, XML shredding, disk/OS
  // syscalls) only ever run when the user explicitly clicks Full Refresh.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  return {
    data,
    error,
    loading,
    lastUpdated,
    lastMode,
    refresh,
    fullRefresh,
    autoRefresh,
    setAutoRefresh,
    refreshPanel,
    panelLoading,
    panelUpdatedAt,
    refreshChecks,
    refreshStartedAt,
  };
}
