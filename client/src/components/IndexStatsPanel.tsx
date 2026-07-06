import type { IndexStats } from "../types";

// index_id is shown instead of a resolved index name - see indexStats.ts for why (resolving
// names across every database on the server needs per-database dynamic SQL, which this app
// avoids for reliability across arbitrary server configurations).
export function IndexStatsPanel({ indexStats }: { indexStats: IndexStats }) {
  const { topScannedTables, unusedIndexes } = indexStats;
  const flagged = topScannedTables.length > 0 || unusedIndexes.length > 0;

  return (
    <section id="panel-indexes" className={`panel ${flagged ? "panel-flagged" : ""}`}>
      <div className="panel-header">
        <h2>Top Tables by Scans</h2>
        <span className="panel-hint">since last restart - a high scan count relative to seeks can mean a missing index</span>
      </div>
      {topScannedTables.length === 0 ? (
        <div className="empty-panel">No table has significant scan activity.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Database</th>
                <th>Table</th>
                <th>Scans</th>
                <th>Seeks</th>
                <th>Lookups</th>
              </tr>
            </thead>
            <tbody>
              {topScannedTables.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.databaseName}</td>
                  <td>{row.tableName}</td>
                  <td>{row.totalScans.toLocaleString()}</td>
                  <td>{row.totalSeeks.toLocaleString()}</td>
                  <td>{row.totalLookups.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-header" style={{ marginTop: 20 }}>
        <h2>Unused Indexes</h2>
        <span className="panel-hint">since last restart - written to but never read; pure write overhead</span>
      </div>
      {unusedIndexes.length === 0 ? (
        <div className="empty-panel">No index has write activity with zero reads.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Database</th>
                <th>Table</th>
                <th>Index ID</th>
                <th>Writes</th>
              </tr>
            </thead>
            <tbody>
              {unusedIndexes.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.databaseName}</td>
                  <td>{row.tableName}</td>
                  <td>{row.indexId}</td>
                  <td>{row.totalWrites.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
