import { useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
import type { TopQueryMetric } from "../types";

const METRIC_LABELS: Record<TopQueryMetric, string> = {
  cpu: "CPU Time",
  duration: "Duration",
  reads: "Logical Reads",
  writes: "Logical Writes",
  executions: "Executions",
};

function truncate(text: string, max = 160) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function formatMs(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

export function TopQueriesTable() {
  const [metric, setMetric] = useState<TopQueryMetric>("cpu");
  const { data, error, loading } = usePolling(() => api.topQueries(metric, 25), 10000, true);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Top Queries</h2>
        <div className="metric-picker">
          {(Object.keys(METRIC_LABELS) as TopQueryMetric[]).map((m) => (
            <button key={m} className={m === metric ? "active" : ""} onClick={() => setMetric(m)}>
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="message error">{error}</div>}
      {loading && !data && <div className="loading">Loading...</div>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Query</th>
                <th>DB</th>
                <th>Executions</th>
                <th>Avg CPU</th>
                <th>Avg Duration</th>
                <th>Avg Reads</th>
                <th>Last Run</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx}>
                  <td className="query-cell" title={row.queryText}>
                    <code>{truncate(row.queryText)}</code>
                  </td>
                  <td>{row.databaseName ?? "-"}</td>
                  <td>{row.executionCount.toLocaleString()}</td>
                  <td>{formatMs(row.avgWorkerTimeMs)}</td>
                  <td>{formatMs(row.avgElapsedTimeMs)}</td>
                  <td>{row.avgLogicalReads.toLocaleString()}</td>
                  <td>{new Date(row.lastExecutionTime).toLocaleString()}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">No query stats available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
