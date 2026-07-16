import { StatCard } from "./StatCard";
import type { PressureStats } from "../types";

// Every stat here answers "how much pressure," never "who's causing it" - that's always the
// Consumers tab (top CPU/memory/IO burners, with query text), which is why every one of these
// stats' StatCard hint and diagnosis.ts's advice text both point there. onViewConsumers is
// optional so this panel still renders standalone (e.g. in a future context with no tab switcher).
export function PressurePanel({ pressure, onViewConsumers }: { pressure: PressureStats; onViewConsumers?: () => void }) {
  return (
    <section id="panel-pressure" className="panel">
      <div className="panel-header">
        <h2>CPU & Memory Pressure</h2>
        {onViewConsumers && (
          <button className="diagnosis-jump" onClick={onViewConsumers} title="See which session/query is actually driving these numbers">
            Who's causing this? →
          </button>
        )}
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
          hint="User tasks ready to run but waiting for a free CPU core, right now (SQL Server's own background workers - lazy writer, checkpoint, etc. - are excluded, so this only reflects real user-driven CPU pressure). Non-zero means true scheduler/CPU pressure, distinct from Signal Wait % (which needs a sample window to compute). A single query running in parallel can account for several of these from just one row in Consumers, so this number doesn't need to match the Consumers row count."
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
