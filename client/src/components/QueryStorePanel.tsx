import { Section } from "./Section";
import { truncate } from "../format";
import type { QueryStoreDatabaseFailure, QueryStoreRegression } from "../types";

export function QueryStorePanel({
  queryStoreRegressions,
  queryStoreDatabaseCount,
  queryStoreFailedDatabases,
}: {
  queryStoreRegressions: QueryStoreRegression[];
  queryStoreDatabaseCount?: number;
  queryStoreFailedDatabases?: QueryStoreDatabaseFailure[];
}) {
  const databaseCount = queryStoreDatabaseCount ?? 0;
  const failedDatabases = queryStoreFailedDatabases ?? [];
  const checkedCount = databaseCount - failedDatabases.length;

  // A failure must never render as Section's plain "nothing found" empty state - that's exactly
  // the "timeout silently read as clean" bug this is fixing. isEmpty only means "genuinely
  // nothing to report" (no rows AND no failures); a failure always falls into the children branch
  // below so its warning note is guaranteed to render, whether or not any regressions were found.
  const isEmpty = queryStoreRegressions.length === 0 && failedDatabases.length === 0;
  const emptyText =
    databaseCount === 0
      ? "No database on this server has Query Store enabled."
      : `No query has regressed against its own recent history across ${databaseCount} Query Store-enabled database(s) checked.`;

  return (
    <Section
      id="panel-querystore"
      title="Query Store Regressions"
      badge={
        <span className="panel-hint">
          queries ≥3x slower than their own recent average (≥5x if fewer than 5 recent executions) · last 24h ·{" "}
          {databaseCount === 0 ? "no databases have Query Store enabled" : `${checkedCount} of ${databaseCount} Query Store-enabled database(s) checked`}
        </span>
      }
      isEmpty={isEmpty}
      emptyText={emptyText}
    >
      <>
        {failedDatabases.length > 0 && (
          <div className="panel-warning-note">
            <div>
              ⚠ Could not check {failedDatabases.length} database{failedDatabases.length === 1 ? "" : "s"} — click{" "}
              <strong>↻ Refresh Query Store</strong> above to retry:
            </div>
            <ul>
              {failedDatabases.map((f) => (
                <li key={f.database}>
                  <strong>{f.database}</strong>: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        {queryStoreRegressions.length === 0 ? (
          <div className="empty-panel">
            No query has regressed against its own recent history across the {checkedCount} database(s) that were checked.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Database</th>
                  <th className="num">Query ID</th>
                  <th>Query</th>
                  <th className="num">Recent Avg</th>
                  <th className="num">Prior Avg</th>
                  <th className="num">Ratio</th>
                  <th className="num">Recent CPU</th>
                  <th className="num">Executions</th>
                </tr>
              </thead>
              <tbody>
                {queryStoreRegressions.map((row) => (
                  <tr key={`${row.databaseName}-${row.queryId}`}>
                    <td>{row.databaseName}</td>
                    <td className="num">{row.queryId}</td>
                    <td title={row.queryText}>{truncate(row.queryText, 120)}</td>
                    <td className="num">{row.recentAvgDurationMs.toFixed(0)} ms</td>
                    <td className="num">{row.priorAvgDurationMs.toFixed(0)} ms</td>
                    <td className="num">
                      {row.regressionRatio.toFixed(1)}x
                      {row.lowConfidence && (
                        <span
                          className="wait-type-cell"
                          title="Low confidence: built from only a few recent executions. A ratio from a thin sample can look dramatic just from normal run-to-run variance (cold cache, a brief wait) - worth a manual check before treating this as a confirmed regression."
                        >
                          {" "}
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="num">{row.recentAvgCpuMs.toFixed(0)} ms</td>
                    <td className="num">{row.executionCount}</td>
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
