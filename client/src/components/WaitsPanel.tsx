import { Section } from "./Section";
import { formatMs } from "../format";
import type { CurrentWaitRow } from "../types";

export function WaitsPanel({ waits }: { waits: CurrentWaitRow[] }) {
  return (
    <Section
      id="panel-waits"
      title="Current Waits"
      badge={<span className="panel-hint">excludes benign background waits</span>}
      isEmpty={waits.length === 0}
      emptyText="No sessions are currently waiting on anything notable."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>DB</th>
              <th>Wait Type</th>
              <th>Waiting</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            {waits.map((w, idx) => (
              <tr key={idx}>
                <td>{w.sessionId}</td>
                <td>{w.databaseName ?? "-"}</td>
                <td>{w.waitType}</td>
                <td>{formatMs(w.waitDurationMs)}</td>
                <td title={w.resourceDescription ?? undefined}>{w.resourceDescription ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
