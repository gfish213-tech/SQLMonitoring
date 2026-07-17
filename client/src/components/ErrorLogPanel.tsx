import { Section } from "./Section";
import { truncate } from "../format";
import type { ErrorLogEntry } from "../types";

export function ErrorLogPanel({
  errorLogEntries,
  errorLogError,
}: {
  errorLogEntries: ErrorLogEntry[];
  errorLogError?: string | null;
}) {
  // A failed check must never render as Section's plain "nothing found" empty state - the same
  // "silently read as clean" bug queryStoreRegressions.ts had. isEmpty only means "genuinely
  // nothing to report"; a failure always falls into the children branch so its warning is guaranteed
  // to render, whether or not any entries were also returned.
  const isEmpty = errorLogEntries.length === 0 && !errorLogError;

  return (
    <Section
      id="panel-errorlog"
      title="Error Log"
      badge={<span className="panel-hint">severity 16+ only · last 24 hours · current log file</span>}
      isEmpty={isEmpty}
      emptyText="No severity 16+ entries in the error log in the last 24 hours."
    >
      <>
        {errorLogError && (
          <div className="panel-warning-note">
            ⚠ Could not read the error log — click <strong>↻ Refresh Error Log</strong> above to retry: {errorLogError}
          </div>
        )}
        {errorLogEntries.length === 0 ? (
          <div className="empty-panel">No severity 16+ entries in the error log in the last 24 hours.</div>
        ) : (
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
        )}
      </>
    </Section>
  );
}
