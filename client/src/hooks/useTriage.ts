import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { TriageData } from "../types";

const AUTO_REFRESH_INTERVAL_MS = 20000;

export function useTriage() {
  const [data, setData] = useState<TriageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.triage();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once on mount. Deliberately no default interval — this tool exists to check on a
  // server that may already be struggling, so it must not add its own background query load
  // unless the user explicitly opts into auto-refresh below.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  return { data, error, loading, lastUpdated, refresh, autoRefresh, setAutoRefresh };
}
