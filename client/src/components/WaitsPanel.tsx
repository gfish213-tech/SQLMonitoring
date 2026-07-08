import { Section } from "./Section";
import { formatMs } from "../format";
import { describeWaitType } from "../waitTypes";
import type { CurrentWaitRow } from "../types";

export function WaitsPanel({ waits }: { waits: CurrentWaitRow[] }) {
  return (
    <Section
      id="panel-waits"
      title="Current Waits"
      badge={<span className="panel-hint">excludes benign background waits · hover a wait type for what it means</span>}
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
                <td className="num">{formatMs(w.waitDurationMs)}</td>
                <td title={w.resourceDescription ?? undefined}>{w.resourceDescription ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
