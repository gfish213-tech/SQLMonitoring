import { Section } from "./Section";
import type { IoLatencyRow } from "../types";

export function IoLatencyPanel({ ioLatency }: { ioLatency: IoLatencyRow[] }) {
  return (
    <Section
      title="Disk / IO Latency"
      isEmpty={ioLatency.length === 0}
      emptyText="No database file has elevated average read/write latency."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Database</th>
              <th>File</th>
              <th>Avg Read Latency</th>
              <th>Avg Write Latency</th>
            </tr>
          </thead>
          <tbody>
            {ioLatency.map((row, idx) => (
              <tr key={idx}>
                <td>{row.databaseName}</td>
                <td title={row.fileName}>{row.fileName.split("\\").pop()}</td>
                <td>{row.avgReadLatencyMs !== null ? `${row.avgReadLatencyMs} ms` : "-"}</td>
                <td>{row.avgWriteLatencyMs !== null ? `${row.avgWriteLatencyMs} ms` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
