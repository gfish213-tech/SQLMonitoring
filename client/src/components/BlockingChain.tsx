import { api } from "../api";
import { usePolling } from "../hooks/usePolling";

export function BlockingChain() {
  const { data, error, loading } = usePolling(() => api.blocking(), 5000, true);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Blocking Chains</h2>
      </div>
      {error && <div className="message error">{error}</div>}
      {loading && !data && <div className="loading">Loading...</div>}
      {data && data.length === 0 && <div className="empty-panel">No blocking detected.</div>}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Blocked By</th>
                <th>Wait Type</th>
                <th>Wait (ms)</th>
                <th>Resource</th>
                <th>Login</th>
                <th>DB</th>
                <th>Query</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} className="blocked-row">
                  <td>{row.sessionId}</td>
                  <td>{row.blockingSessionId}</td>
                  <td>{row.waitType ?? "-"}</td>
                  <td>{row.waitTimeMs.toLocaleString()}</td>
                  <td title={row.waitResource ?? undefined}>{row.waitResource ?? "-"}</td>
                  <td>{row.loginName ?? "-"}</td>
                  <td>{row.databaseName ?? "-"}</td>
                  <td className="query-cell" title={row.queryText ?? undefined}>
                    <code>{(row.queryText ?? "").trim().replace(/\s+/g, " ").slice(0, 100)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
