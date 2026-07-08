import { Section } from "./Section";
import { formatMs } from "../format";
import type { AutogrowthEvent } from "../types";

export function AutogrowthPanel({ autogrowth }: { autogrowth: AutogrowthEvent[] }) {
  return (
    <Section
      id="panel-autogrowth"
      title="Recent Auto-Growth Events"
      badge={<span className="panel-hint">last 24 hours</span>}
      isEmpty={autogrowth.length === 0}
      emptyText="No data/log file auto-growth events in the last 24 hours."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Database</th>
              <th>File</th>
              <th>Type</th>
              <th>When</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {autogrowth.map((row, idx) => (
              <tr key={idx}>
                <td>{row.databaseName ?? "-"}</td>
                <td title={row.fileName ?? undefined}>{row.fileName?.split("\\").pop() ?? "-"}</td>
                <td>{row.eventType}</td>
                <td>{new Date(row.startTime).toLocaleString()}</td>
                <td className="num">{formatMs(row.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
