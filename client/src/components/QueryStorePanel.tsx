import { Section } from "./Section";
import { truncate } from "../format";
import type { QueryStoreRegression } from "../types";

export function QueryStorePanel({
  queryStoreRegressions,
  queryStoreDatabaseCount,
  queryStoreFailedDatabases,
}: {
  queryStoreRegressions: QueryStoreRegression[];
  queryStoreDatabaseCount?: number;
  queryStoreFailedDatabases?: string[];
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
          queries ≥3x slower than their own recent average · last 24h ·{" "}
          {databaseCount === 0 ? "no databases have Query Store enabled" : `${checkedCount} of ${databaseCount} Query Store-enabled database(s) checked`}
        </span>
      }
      isEmpty={isEmpty}
      emptyText={emptyText}
    >
      <>
        {failedDatabases.length > 0 && (
          <div className="panel-warning-note">
            ⚠ Could not check {failedDatabases.length} database{failedDatabases.length === 1 ? "" : "s"} in time: {failedDatabases.join(", ")}. Likely a
            timeout on a database with a large number of distinct queries tracked in Query Store — click ↻ Refresh Query Store above to retry.
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
                    <td title={row.queryText}>{truncate(row.queryText, 120)}</td>
                    <td className="num">{row.recentAvgDurationMs.toFixed(0)} ms</td>
                    <td className="num">{row.priorAvgDurationMs.toFixed(0)} ms</td>
                    <td className="num">{row.regressionRatio.toFixed(1)}x</td>
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
