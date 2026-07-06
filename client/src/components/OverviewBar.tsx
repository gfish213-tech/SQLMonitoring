import { StatCard } from "./StatCard";
import type { OverviewStats } from "../types";

export function OverviewBar({ overview }: { overview: OverviewStats }) {
  return (
    <div className="stat-grid">
      <StatCard label="CPU Cores" value={String(overview.cpuCount)} />
      <StatCard label="Active Sessions" value={String(overview.activeSessionCount)} />
      <StatCard label="Active Requests" value={String(overview.activeRequestCount)} />
      <StatCard
        label="Blocked Requests"
        value={String(overview.blockedRequestCount)}
        tone={overview.blockedRequestCount > 0 ? "danger" : undefined}
      />
      <StatCard
        label="Batch Requests/sec"
        value={overview.batchRequestsPerSec !== null ? overview.batchRequestsPerSec.toLocaleString() : "-"}
      />
      <StatCard label="Server Start Time" value={new Date(overview.sqlServerStartTime).toLocaleString()} />
    </div>
  );
}
