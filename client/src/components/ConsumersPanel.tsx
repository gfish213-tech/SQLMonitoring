import { Section } from "./Section";
import { formatMs, truncate } from "../format";
import type { ConsumerRow } from "../types";

export function ConsumersPanel({ consumers }: { consumers: ConsumerRow[] }) {
  return (
    <Section
      id="panel-consumers"
      title="Top Resource Consumers (Right Now)"
      badge={<span className="panel-hint">top 20 by CPU time</span>}
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
              <th>Logical Reads</th>
              <th>Physical Reads</th>
              <th>Writes</th>
              <th>TempDB</th>
              <th>Memory Grant</th>
              <th>Wait</th>
              <th>Blocked By</th>
              <th>Query</th>
            </tr>
          </thead>
          <tbody>
            {consumers.map((c) => (
              <tr key={c.sessionId} className={c.blockingSessionId ? "blocked-row" : ""}>
                <td className="num">{c.sessionId}</td>
                <td>{c.loginName}</td>
                <td>
                  {c.hostName ?? "-"} / {c.programName ?? "-"}
                </td>
                <td>{c.databaseName ?? "-"}</td>
                <td className="num">{formatMs(c.cpuTimeMs)}</td>
                <td className="num">{formatMs(c.elapsedMs)}</td>
                <td className="num">{c.logicalReads.toLocaleString()}</td>
                <td className="num">{c.physicalReads.toLocaleString()}</td>
                <td className="num">{c.writes.toLocaleString()}</td>
                <td className="num">{c.tempdbMb !== null && c.tempdbMb > 0 ? `${c.tempdbMb} MB` : "-"}</td>
                <td className="num">
                  {c.memoryGrantMb !== null ? (
                    c.memoryGrantPending ? (
                      <span className="mem-grant-pending">waiting for {c.memoryGrantMb} MB</span>
                    ) : (
                      `${c.memoryGrantMb} MB`
                    )
                  ) : (
                    "-"
                  )}
                </td>
                <td>{c.waitType ?? "-"}</td>
                <td className="num">{c.blockingSessionId ?? "-"}</td>
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
