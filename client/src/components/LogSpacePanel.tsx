import { Section } from "./Section";
import type { LogSpaceRow } from "../types";

export function LogSpacePanel({ logSpace }: { logSpace: LogSpaceRow[] }) {
  return (
    <Section
      title="Transaction Log Space"
      isEmpty={logSpace.length === 0}
      emptyText="No database has a transaction log over 50% full."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Database</th>
              <th>Log Size</th>
              <th>Used</th>
            </tr>
          </thead>
          <tbody>
            {logSpace.map((row) => (
              <tr key={row.databaseName} className={row.logUsedPercent > 90 ? "blocked-row" : ""}>
                <td>{row.databaseName}</td>
                <td>{row.logSizeMb.toLocaleString()} MB</td>
                <td>{row.logUsedPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
