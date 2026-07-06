import { getPool } from "../db";

export interface IoLatencyRow {
  databaseName: string;
  fileName: string;
  avgReadLatencyMs: number | null;
  avgWriteLatencyMs: number | null;
}

// sys.dm_io_virtual_file_stats is cumulative since SQL Server started, so this shows average
// latency over the server's whole uptime, not just "right now" — still useful to rule disk
// I/O in or out as a systemic cause. Only surfaces files with enough activity to be meaningful
// and latency above a threshold worth caring about.
export async function getIoLatency(): Promise<IoLatencyRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT TOP 15
      DB_NAME(vfs.database_id) AS database_name,
      mf.physical_name AS file_name,
      CASE WHEN vfs.num_of_reads > 0 THEN CAST(vfs.io_stall_read_ms * 1.0 / vfs.num_of_reads AS DECIMAL(10, 2)) ELSE NULL END AS avg_read_latency_ms,
      CASE WHEN vfs.num_of_writes > 0 THEN CAST(vfs.io_stall_write_ms * 1.0 / vfs.num_of_writes AS DECIMAL(10, 2)) ELSE NULL END AS avg_write_latency_ms
    FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
    INNER JOIN sys.master_files mf ON mf.database_id = vfs.database_id AND mf.file_id = vfs.file_id
    WHERE (vfs.num_of_reads > 100 OR vfs.num_of_writes > 100)
      AND (
        (vfs.num_of_reads > 0 AND vfs.io_stall_read_ms * 1.0 / vfs.num_of_reads > 15)
        OR (vfs.num_of_writes > 0 AND vfs.io_stall_write_ms * 1.0 / vfs.num_of_writes > 15)
      )
    ORDER BY (vfs.io_stall_read_ms + vfs.io_stall_write_ms) DESC
  `);

  return result.recordset.map((row) => ({
    databaseName: row.database_name,
    fileName: row.file_name,
    avgReadLatencyMs: row.avg_read_latency_ms,
    avgWriteLatencyMs: row.avg_write_latency_ms,
  }));
}
