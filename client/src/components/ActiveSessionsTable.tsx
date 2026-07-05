import { api } from "../api";
import { usePolling } from "../hooks/usePolling";

export function ActiveSessionsTable() {
  const { data, error, loading } = usePolling(() => api.sessions(), 5000, true);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Active Sessions</h2>
      </div>
      {error && <div className="message error">{error}</div>}
      {loading && !data && <div className="loading">Loading...</div>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Login</th>
                <th>Host / App</th>
                <th>DB</th>
                <th>Status</th>
                <th>Wait</th>
                <th>Blocked By</th>
                <th>CPU (ms)</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.sessionId} className={row.blockingSessionId ? "blocked-row" : ""}>
                  <td>{row.sessionId}</td>
                  <td>{row.loginName}</td>
                  <td>{row.hostName ?? "-"} / {row.programName ?? "-"}</td>
                  <td>{row.databaseName ?? "-"}</td>
                  <td>{row.status}</td>
                  <td>{row.waitType ?? "-"}</td>
                  <td>{row.blockingSessionId ?? "-"}</td>
                  <td>{row.cpuTimeMs.toLocaleString()}</td>
                  <td>{row.totalElapsedTimeMs ? `${row.totalElapsedTimeMs} ms` : "-"}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">No active user sessions.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
