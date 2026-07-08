import type { LogSpaceRow, VlfCountRow } from "../types";

// Two independent checks share this tab (log fullness and VLF fragmentation aren't correlated -
// a mostly-empty log can still be badly fragmented from past growth), so this doesn't use the
// shared Section wrapper: each half needs its own empty state regardless of the other's.
export function LogSpacePanel({ logSpace, vlfCounts }: { logSpace: LogSpaceRow[]; vlfCounts?: VlfCountRow[] }) {
  const flagged = logSpace.length > 0 || (vlfCounts?.length ?? 0) > 0;

  return (
    <section id="panel-logspace" className={`panel ${flagged ? "panel-flagged" : ""}`}>
      <div className="panel-header">
        <h2>Transaction Log Space</h2>
        <span className="panel-hint">only databases over 50% log used are shown</span>
      </div>
      {logSpace.length === 0 ? (
        <div className="empty-panel">No database has a transaction log over 50% full.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Database</th>
                <th className="num">Log Size</th>
                <th className="num">Used</th>
              </tr>
            </thead>
            <tbody>
              {logSpace.map((row) => (
                <tr key={row.databaseName} className={row.logUsedPercent > 90 ? "blocked-row" : ""}>
                  <td>{row.databaseName}</td>
                  <td className="num">{row.logSizeMb.toLocaleString()} MB</td>
                  <td className="num">{row.logUsedPercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-header" style={{ marginTop: 20 }}>
        <h2>Virtual Log File (VLF) Count</h2>
        <span className="panel-hint">only databases over 100 VLFs shown; requires SQL Server 2017+</span>
      </div>
      {vlfCounts === undefined ? (
        <div className="empty-panel">
          Not checked in this quick refresh — click <strong>Full Refresh</strong> to check this.
        </div>
      ) : vlfCounts.length === 0 ? (
        <div className="empty-panel">No database has an excessive VLF count.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Database</th>
                <th className="num">VLF Count</th>
              </tr>
            </thead>
            <tbody>
              {vlfCounts.map((row) => (
                <tr key={row.databaseName} className={row.vlfCount > 1000 ? "blocked-row" : ""}>
                  <td>{row.databaseName}</td>
                  <td className="num">{row.vlfCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
