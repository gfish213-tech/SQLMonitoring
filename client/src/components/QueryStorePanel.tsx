import { Section } from "./Section";
import { truncate } from "../format";
import type { QueryStoreRegression } from "../types";

export function QueryStorePanel({ queryStoreRegressions }: { queryStoreRegressions: QueryStoreRegression[] }) {
  return (
    <Section
      id="panel-querystore"
      title="Query Store Regressions"
      badge={<span className="panel-hint">queries ≥3x slower than their own recent average · last 24h · Query Store-enabled databases only</span>}
      isEmpty={queryStoreRegressions.length === 0}
      emptyText="No query has regressed against its own recent history in any Query Store-enabled database."
    >
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
    </Section>
  );
}
