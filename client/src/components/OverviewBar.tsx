import { StatCard } from "./StatCard";
import type { OverviewStats } from "../types";

export function OverviewBar({ overview }: { overview: OverviewStats }) {
  return (
    <div id="panel-overview" className="stat-grid">
      <StatCard label="CPU Cores" value={String(overview.cpuCount)} />
      <StatCard label="Active Sessions" value={String(overview.activeSessionCount)} />
      <StatCard label="Active Requests" value={String(overview.activeRequestCount)} />
      <StatCard
        label="Blocked Requests"
        value={String(overview.blockedRequestCount)}
        tone={overview.blockedRequestCount > 0 ? "danger" : undefined}
        hint="Requests currently waiting on another session's lock, right now."
      />
      <StatCard
        label="Batch Requests/sec"
        value={overview.batchRequestsPerSec !== null ? overview.batchRequestsPerSec.toLocaleString() : "-"}
        hint="Measured over a real 1-second sample taken during this refresh, not a since-restart average."
      />
      <StatCard
        label="Server Start Time"
        value={new Date(overview.sqlServerStartTime).toLocaleString()}
        hint="How long since the last restart - relevant because several DMVs reset at restart, so a young server may have thin history to judge pressure from."
      />
    </div>
  );
}
