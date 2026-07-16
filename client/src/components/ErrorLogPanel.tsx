import { Section } from "./Section";
import { truncate } from "../format";
import type { ErrorLogEntry } from "../types";

export function ErrorLogPanel({ errorLogEntries }: { errorLogEntries: ErrorLogEntry[] }) {
  return (
    <Section
      id="panel-errorlog"
      title="Error Log"
      badge={<span className="panel-hint">severity 16+ only · last 24 hours · current log file</span>}
      isEmpty={errorLogEntries.length === 0}
      emptyText="No severity 16+ entries in the error log in the last 24 hours."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th className="num">Severity</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {errorLogEntries.map((row, idx) => (
              <tr key={idx}>
                <td>{new Date(row.timestamp).toLocaleString()}</td>
                <td className="num">{row.severity ?? "-"}</td>
                <td title={row.message}>{truncate(row.message, 160)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
