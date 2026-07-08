import { Section } from "./Section";
import { formatMs } from "../format";
import { describeWaitType } from "../waitTypes";
import type { CurrentWaitRow } from "../types";

export function WaitsPanel({ waits }: { waits: CurrentWaitRow[] }) {
  return (
    <Section
      id="panel-waits"
      title="Current Waits"
      badge={
        <span className="panel-hint">
          excludes benign background waits · one row per session+wait type, Tasks shows parallel worker count · hover a wait type for
          what it means
        </span>
      }
      isEmpty={waits.length === 0}
      emptyText="No sessions are currently waiting on anything notable."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Session</th>
              <th>DB</th>
              <th>Wait Type</th>
              <th className="num">Tasks</th>
              <th className="num">Waiting</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            {waits.map((w, idx) => (
              <tr key={idx}>
                <td className="num">{w.sessionId}</td>
                <td>{w.databaseName ?? "-"}</td>
                <td className="wait-type-cell" title={describeWaitType(w.waitType) ?? undefined}>
                  {w.waitType}
                </td>
                <td className="num">{w.taskCount}</td>
                <td className="num">{formatMs(w.waitDurationMs)}</td>
                <td title={w.taskCount > 1 ? `One of ${w.taskCount} parallel worker tasks - each has its own resource id` : (w.resourceDescription ?? undefined)}>
                  {w.resourceDescription ?? "-"}
                  {w.taskCount > 1 ? ` (+${w.taskCount - 1} more)` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
