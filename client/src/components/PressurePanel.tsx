import { StatCard } from "./StatCard";
import type { PressureStats } from "../types";

export function PressurePanel({ pressure }: { pressure: PressureStats }) {
  return (
    <section id="panel-pressure" className="panel">
      <div className="panel-header">
        <h2>CPU & Memory Pressure</h2>
      </div>
      <div className="stat-grid">
        <StatCard
          label="Signal Wait % (CPU pressure)"
          value={pressure.signalWaitPercent !== null ? `${pressure.signalWaitPercent}%` : "-"}
          tone={pressure.signalWaitPercent !== null && pressure.signalWaitPercent > 25 ? "danger" : undefined}
          hint="Share of wait time spent waiting for a CPU to free up (not for a resource), measured over a real 1-second sample. Above ~25% suggests the server is CPU-bound right now. '-' means no non-benign waits occurred during the sample second."
        />
        <StatCard
          label="Page Life Expectancy"
          value={pressure.pageLifeExpectancy !== null ? `${pressure.pageLifeExpectancy}s` : "-"}
          tone={pressure.pageLifeExpectancy !== null && pressure.pageLifeExpectancy < 300 ? "warning" : undefined}
          hint="Average seconds a data page stays in memory before being evicted. Below ~300s on a busy server is a common (not absolute) rule-of-thumb sign of memory pressure."
        />
        <StatCard
          label="Buffer Cache Hit Ratio"
          value={pressure.bufferCacheHitRatio !== null ? `${pressure.bufferCacheHitRatio}%` : "-"}
          hint="Share of page requests served from memory instead of disk, measured over the same 1-second sample as Signal Wait %. Sustained low values suggest memory pressure."
        />
        <StatCard
          label="Pending Memory Grants"
          value={String(pressure.pendingMemoryGrants)}
          tone={pressure.pendingMemoryGrants > 0 ? "danger" : undefined}
          hint="Queries currently waiting for a memory grant before they can even start running. Any value above 0 is worth investigating."
        />
        <StatCard
          label="Runnable Tasks"
          value={String(pressure.runnableTasksCount)}
          tone={pressure.runnableTasksCount > 0 ? "warning" : undefined}
          hint="Tasks ready to run but waiting for a free CPU core, right now. Non-zero means true scheduler/CPU pressure, distinct from Signal Wait % (which needs a sample window to compute)."
        />
        <StatCard
          label="Worker Queue"
          value={String(pressure.workQueueCount)}
          tone={pressure.workQueueCount > 0 ? "danger" : undefined}
          hint="Requests waiting for a worker thread before they can even be assigned one. Non-zero means SQL Server has run out of worker threads - new connections may start timing out."
        />
      </div>
    </section>
  );
}
