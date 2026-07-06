import { Section } from "./Section";
import { formatMs, truncate } from "../format";
import type { ConsumerRow } from "../types";

export function ConsumersPanel({ consumers }: { consumers: ConsumerRow[] }) {
  return (
    <Section
      title="Top Resource Consumers (Right Now)"
      isEmpty={consumers.length === 0}
      emptyText="No active requests consuming significant resources right now."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Login</th>
              <th>Host / App</th>
              <th>DB</th>
              <th>CPU</th>
              <th>Elapsed</th>
              <th>Reads</th>
              <th>Writes</th>
              <th>TempDB</th>
              <th>Wait</th>
              <th>Blocked By</th>
              <th>Query</th>
            </tr>
          </thead>
          <tbody>
            {consumers.map((c) => (
              <tr key={c.sessionId} className={c.blockingSessionId ? "blocked-row" : ""}>
                <td>{c.sessionId}</td>
                <td>{c.loginName}</td>
                <td>
                  {c.hostName ?? "-"} / {c.programName ?? "-"}
                </td>
                <td>{c.databaseName ?? "-"}</td>
                <td>{formatMs(c.cpuTimeMs)}</td>
                <td>{formatMs(c.elapsedMs)}</td>
                <td>{c.logicalReads.toLocaleString()}</td>
                <td>{c.writes.toLocaleString()}</td>
                <td>{c.tempdbMb !== null && c.tempdbMb > 0 ? `${c.tempdbMb} MB` : "-"}</td>
                <td>{c.waitType ?? "-"}</td>
                <td>{c.blockingSessionId ?? "-"}</td>
                <td className="query-cell">
                  <code>{c.queryText ? truncate(c.queryText, 100) : "-"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
