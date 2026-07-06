import { StatCard } from "./StatCard";
import type { OverviewStats } from "../types";

export function OverviewBar({ overview }: { overview: OverviewStats }) {
  return (
    <div id="panel-overview">
      <div className="stat-grid">
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
      <div className="stat-grid" style={{ marginTop: 14 }}>
        <StatCard
          label="Plan Cache Size"
          value={`${overview.planCacheMb.toLocaleString()} MB`}
          hint="Total memory holding compiled execution plans. Directly competes with the buffer pool (data cache) for memory."
        />
        <StatCard
          label="Ad-hoc Plans"
          value={overview.adhocPlanCachePercent !== null ? `${overview.adhocPlanCachePercent}%` : "-"}
          tone={overview.adhocPlanCachePercent !== null && overview.adhocPlanCachePercent > 50 ? "warning" : undefined}
          hint="Share of plan cache memory used by unparameterized ad-hoc SQL strings, as opposed to stored procedures or sp_executesql. A high share means plan cache pollution: memory spent on plans that likely won't be reused."
        />
        <StatCard
          label="Single-Use Ad-hoc Plans"
          value={`${overview.singleUseAdhocPlanCount.toLocaleString()} (${overview.singleUseAdhocPlanMb.toLocaleString()} MB)`}
          tone={overview.singleUseAdhocPlanMb > 512 ? "warning" : undefined}
          hint="Ad-hoc plans used exactly once - the clearest sign of an application sending raw SQL instead of parameterized queries. This memory will likely never be reused."
        />
      </div>
    </div>
  );
}
