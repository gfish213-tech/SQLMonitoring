import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
import { StatCard } from "./StatCard";

export function Overview() {
  const { data, error } = usePolling(() => api.overview(), 5000, true);

  if (error) return <div className="message error">{error}</div>;
  if (!data) return <div className="loading">Loading overview...</div>;

  return (
    <div className="stat-grid">
      <StatCard label="CPU Cores" value={String(data.cpuCount)} />
      <StatCard label="Active Sessions" value={String(data.activeSessionCount)} />
      <StatCard label="Active Requests" value={String(data.activeRequestCount)} />
      <StatCard
        label="Blocked Requests"
        value={String(data.blockedRequestCount)}
        tone={data.blockedRequestCount > 0 ? "danger" : undefined}
      />
      <StatCard
        label="Buffer Cache Hit Ratio"
        value={data.bufferCacheHitRatio !== null ? `${data.bufferCacheHitRatio}%` : "-"}
      />
      <StatCard
        label="Page Life Expectancy"
        value={data.pageLifeExpectancy !== null ? `${data.pageLifeExpectancy}s` : "-"}
        tone={data.pageLifeExpectancy !== null && data.pageLifeExpectancy < 300 ? "warning" : undefined}
      />
      <StatCard
        label="Batch Requests/sec"
        value={data.batchRequestsPerSec !== null ? data.batchRequestsPerSec.toLocaleString() : "-"}
      />
      <StatCard label="Server Start Time" value={new Date(data.sqlServerStartTime).toLocaleString()} />
    </div>
  );
}
