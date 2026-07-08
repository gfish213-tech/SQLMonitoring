import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DashboardTab, TriageData } from "../types";

const AUTO_REFRESH_INTERVAL_MS = 20000;

export function useTriage() {
  const [data, setData] = useState<TriageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastMode, setLastMode] = useState<"quick" | "full" | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [panelLoading, setPanelLoading] = useState<DashboardTab | null>(null);
  const [panelUpdatedAt, setPanelUpdatedAt] = useState<Partial<Record<DashboardTab, Date>>>({});

  const fetchMode = useCallback(async (mode: "quick" | "full") => {
    setLoading(true);
    try {
      const result = await api.triage(mode);
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
  };
}
