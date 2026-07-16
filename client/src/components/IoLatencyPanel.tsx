import { Section } from "./Section";
import type { IoLatencyRow } from "../types";

export function IoLatencyPanel({ ioLatency }: { ioLatency: IoLatencyRow[] }) {
  return (
    <Section
      id="panel-iolatency"
      title="Disk / IO Latency"
      badge={
        <span className="panel-hint">
          flagged if either the since-restart average or the last ~1s is elevated · R = read, W = write
        </span>
      }
      isEmpty={ioLatency.length === 0}
      emptyText="No database file has elevated read/write latency."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Database</th>
              <th>File</th>
              <th>Avg Latency (since restart)</th>
              <th>Latency (last ~1s)</th>
              <th>IOPS (last ~1s)</th>
              <th>Throughput (last ~1s)</th>
            </tr>
          </thead>
          <tbody>
            {ioLatency.map((row, idx) => (
              <tr key={idx}>
                <td>{row.databaseName}</td>
                <td title={row.fileName}>{row.fileName.split("\\").pop()}</td>
                <td>
                  R {row.avgReadLatencyMs !== null ? `${row.avgReadLatencyMs}ms` : "-"} / W{" "}
                  {row.avgWriteLatencyMs !== null ? `${row.avgWriteLatencyMs}ms` : "-"}
                </td>
                <td>
                  R {row.currentReadLatencyMs !== null ? `${row.currentReadLatencyMs}ms` : "-"} / W{" "}
                  {row.currentWriteLatencyMs !== null ? `${row.currentWriteLatencyMs}ms` : "-"}
                </td>
                <td>
                  R {row.readIops !== null ? row.readIops.toLocaleString() : "-"} / W{" "}
                  {row.writeIops !== null ? row.writeIops.toLocaleString() : "-"}
                </td>
                <td>
                  R {row.readThroughputMBps !== null ? `${row.readThroughputMBps} MB/s` : "-"} / W{" "}
                  {row.writeThroughputMBps !== null ? `${row.writeThroughputMBps} MB/s` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
