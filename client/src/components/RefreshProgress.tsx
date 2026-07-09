import { useEffect, useState } from "react";
import type { RefreshCheckStatus } from "../hooks/useTriage";

// Human-friendly labels for the panel keys dashboard.ts's /triage route emits progress events
// for (its internal TriageData field names, not always the same as a tab's display name).
const PANEL_LABELS: Record<string, string> = {
  overview: "Overview",
  pressure: "Pressure",
  blocking: "Blocking",
  longOps: "Backups / Long Ops",
  agentJobs: "Agent Jobs",
  waits: "Waits",
  logSpace: "Log Space",
  consumers: "Consumers",
  tempdb: "TempDB",
  vlfCounts: "VLF Counts",
  ioLatency: "IO Latency",
  autogrowth: "Autogrowth",
  deadlocks: "Deadlocks",
  volumeSpace: "Volume Space",
  indexStats: "Indexes",
};

// Shown under the refresh bar only while a refresh is in flight - names exactly which check is
// still running instead of one opaque "Refreshing..." spinner for what can be a several-second
// Full Refresh. Ticks its own clock (independent of any parent re-render) so a still-pending
// check's elapsed time visibly climbs, making the slow one obvious without waiting for it to
// finish first.
export function RefreshProgress({ checks, startedAt }: { checks: RefreshCheckStatus[]; startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [startedAt]);

  if (checks.length === 0 || startedAt === null) return null;
  const doneCount = checks.filter((c) => c.status !== "pending").length;

  return (
    <div className="refresh-progress">
      <span className="refresh-progress-count">
        {doneCount}/{checks.length} checks done
      </span>
      <span className="refresh-progress-chips">
        {checks.map((c) => {
          const seconds = c.status === "pending" ? (now - startedAt) / 1000 : (c.ms ?? 0) / 1000;
          return (
            <span key={c.panel} className={`refresh-chip refresh-chip-${c.status}`}>
              {c.status === "done" ? "✓" : c.status === "error" ? "✕" : "…"} {PANEL_LABELS[c.panel] ?? c.panel} {seconds.toFixed(1)}s
            </span>
          );
        })}
      </span>
    </div>
  );
}
