import { StatCard } from "./StatCard";
import type { PressureStats } from "../types";

export function PressurePanel({ pressure }: { pressure: PressureStats }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>CPU & Memory Pressure</h2>
      </div>
      <div className="stat-grid">
        <StatCard
          label="Signal Wait % (CPU pressure)"
          value={pressure.signalWaitPercent !== null ? `${pressure.signalWaitPercent}%` : "-"}
          tone={pressure.signalWaitPercent !== null && pressure.signalWaitPercent > 25 ? "danger" : undefined}
        />
        <StatCard
          label="Page Life Expectancy"
          value={pressure.pageLifeExpectancy !== null ? `${pressure.pageLifeExpectancy}s` : "-"}
          tone={pressure.pageLifeExpectancy !== null && pressure.pageLifeExpectancy < 300 ? "warning" : undefined}
        />
        <StatCard
          label="Buffer Cache Hit Ratio"
          value={pressure.bufferCacheHitRatio !== null ? `${pressure.bufferCacheHitRatio}%` : "-"}
        />
        <StatCard
          label="Pending Memory Grants"
          value={String(pressure.pendingMemoryGrants)}
          tone={pressure.pendingMemoryGrants > 0 ? "danger" : undefined}
        />
      </div>
    </section>
  );
}
