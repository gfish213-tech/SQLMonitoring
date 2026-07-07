import { Section } from "./Section";
import { formatMs, truncate } from "../format";
import type { LeadBlocker } from "../types";

export function BlockingPanel({ blocking }: { blocking: LeadBlocker[] }) {
  return (
    <Section id="panel-blocking" title="Blocking & Long Transactions" isEmpty={blocking.length === 0} emptyText="No blocking detected.">
      <div className="blocker-list">
        {blocking.map((b) => (
          <div className="blocker-card" key={b.sessionId}>
            <div className="blocker-head">
              <span className="blocker-session">Session {b.sessionId}</span>
              <span>{b.loginName ?? "-"}</span>
              <span>{b.hostName ?? "-"}</span>
              <span className={`blocker-status ${b.isIdleWithOpenTransaction ? "flagged" : ""}`}>
                {b.isIdleWithOpenTransaction ? "Idle with open transaction" : b.status}
              </span>
              <span className="blocker-count">blocking {b.blockedSessions.length} session{b.blockedSessions.length === 1 ? "" : "s"}</span>
            </div>
            {b.openTransactionCount > 0 && (
              <div className="blocker-detail">Open transactions: {b.openTransactionCount} · DB: {b.databaseName ?? "-"}</div>
            )}
            {b.lastStatementText && (
              <div className="blocker-detail">
                Last statement{b.lastRequestEndTime ? ` (ended ${new Date(b.lastRequestEndTime).toLocaleTimeString()})` : ""}:{" "}
                <code>{truncate(b.lastStatementText)}</code>
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Waiting Session</th>
                    <th>Waiting On</th>
                    <th>Login</th>
                    <th>DB</th>
                    <th>Wait Type</th>
                    <th>Wait Time</th>
                    <th>Resource</th>
                    <th>Query</th>
                  </tr>
                </thead>
                <tbody>
                  {b.blockedSessions.map((w) => (
                    <tr key={w.sessionId}>
                      <td className="num">{w.sessionId}</td>
                      <td className="num">{w.blockedBy}</td>
                      <td>{w.loginName ?? "-"}</td>
                      <td>{w.databaseName ?? "-"}</td>
                      <td>{w.waitType ?? "-"}</td>
                      <td className="num">{formatMs(w.waitTimeMs)}</td>
                      <td title={w.waitResource ?? undefined}>{w.waitResource ?? "-"}</td>
                      <td className="query-cell">
                        <code>{w.queryText ? truncate(w.queryText, 90) : "-"}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
