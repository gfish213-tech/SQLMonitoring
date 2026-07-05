import { api } from "../api";
import { usePolling } from "../hooks/usePolling";

export function WaitStatsTable() {
  const { data, error, loading } = usePolling(() => api.waits(15), 10000, true);
  const maxWait = data && data.length > 0 ? data[0].waitTimeMs : 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Top Wait Types</h2>
      </div>
      {error && <div className="message error">{error}</div>}
      {loading && !data && <div className="loading">Loading...</div>}
      {data && (
        <div className="wait-list">
          {data.map((row) => (
            <div className="wait-row" key={row.waitType}>
              <div className="wait-label">
                <span>{row.waitType}</span>
                <span className="wait-value">{(row.waitTimeMs / 1000).toFixed(1)}s</span>
              </div>
              <div className="wait-bar-track">
                <div
                  className="wait-bar-fill"
                  style={{ width: maxWait > 0 ? `${(row.waitTimeMs / maxWait) * 100}%` : "0%" }}
                />
              </div>
            </div>
          ))}
          {data.length === 0 && <div className="empty-panel">No significant waits.</div>}
        </div>
      )}
    </section>
  );
}
