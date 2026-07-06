import { getPool } from "../db";

export interface IoLatencyRow {
  databaseName: string;
  fileName: string;
  avgReadLatencyMs: number | null;
  avgWriteLatencyMs: number | null;
  currentReadLatencyMs: number | null;
  currentWriteLatencyMs: number | null;
  readIops: number | null;
  writeIops: number | null;
  readThroughputMBps: number | null;
  writeThroughputMBps: number | null;
}

// sys.dm_io_virtual_file_stats is cumulative since SQL Server started, so the plain average is
// diluted by however long the server's been up - a file that started stalling badly ten minutes
// ago barely moves a lifetime average on a server that's been up for months. Sample it twice,
// ~1 second apart, and report both: the since-restart average (still useful to rule I/O in or
// out as a systemic cause) and the current delta (what's actually happening right now), plus
// IOPS/throughput computed from the same two samples so a high latency reading can be told
// apart from a saturated-but-otherwise-healthy drive. A file is surfaced if EITHER figure
// crosses the threshold, so a current spike isn't hidden by good history.
export async function getIoLatency(): Promise<IoLatencyRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    DECLARE @t1 TABLE (
      database_id INT, file_id INT,
      num_of_reads BIGINT, num_of_writes BIGINT,
      io_stall_read_ms BIGINT, io_stall_write_ms BIGINT,
      num_of_bytes_read BIGINT, num_of_bytes_written BIGINT
    );
    DECLARE @sampleStart DATETIME2 = SYSDATETIME();

    INSERT INTO @t1
    SELECT database_id, file_id, num_of_reads, num_of_writes, io_stall_read_ms, io_stall_write_ms, num_of_bytes_read, num_of_bytes_written
    FROM sys.dm_io_virtual_file_stats(NULL, NULL);

    WAITFOR DELAY '00:00:01';

    DECLARE @elapsedMs INT = DATEDIFF(MILLISECOND, @sampleStart, SYSDATETIME());

    SELECT TOP 15
      DB_NAME(vfs.database_id) AS database_name,
      mf.physical_name AS file_name,
      CASE WHEN vfs.num_of_reads > 0 THEN CAST(vfs.io_stall_read_ms * 1.0 / vfs.num_of_reads AS DECIMAL(10, 2)) ELSE NULL END AS avg_read_latency_ms,
      CASE WHEN vfs.num_of_writes > 0 THEN CAST(vfs.io_stall_write_ms * 1.0 / vfs.num_of_writes AS DECIMAL(10, 2)) ELSE NULL END AS avg_write_latency_ms,
      (vfs.num_of_reads - t1.num_of_reads) AS delta_reads,
      (vfs.num_of_writes - t1.num_of_writes) AS delta_writes,
      (vfs.io_stall_read_ms - t1.io_stall_read_ms) AS delta_read_stall_ms,
      (vfs.io_stall_write_ms - t1.io_stall_write_ms) AS delta_write_stall_ms,
      (vfs.num_of_bytes_read - t1.num_of_bytes_read) AS delta_bytes_read,
      (vfs.num_of_bytes_written - t1.num_of_bytes_written) AS delta_bytes_written,
      @elapsedMs AS elapsed_ms
    FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
    INNER JOIN @t1 t1 ON t1.database_id = vfs.database_id AND t1.file_id = vfs.file_id
    INNER JOIN sys.master_files mf ON mf.database_id = vfs.database_id AND mf.file_id = vfs.file_id
    WHERE (vfs.num_of_reads > 100 OR vfs.num_of_writes > 100 OR (vfs.num_of_reads - t1.num_of_reads) > 10 OR (vfs.num_of_writes - t1.num_of_writes) > 10)
      AND (
        (vfs.num_of_reads > 0 AND vfs.io_stall_read_ms * 1.0 / vfs.num_of_reads > 15)
        OR (vfs.num_of_writes > 0 AND vfs.io_stall_write_ms * 1.0 / vfs.num_of_writes > 15)
        OR ((vfs.num_of_reads - t1.num_of_reads) > 0 AND (vfs.io_stall_read_ms - t1.io_stall_read_ms) * 1.0 / (vfs.num_of_reads - t1.num_of_reads) > 15)
        OR ((vfs.num_of_writes - t1.num_of_writes) > 0 AND (vfs.io_stall_write_ms - t1.io_stall_write_ms) * 1.0 / (vfs.num_of_writes - t1.num_of_writes) > 15)
      )
    ORDER BY (vfs.io_stall_read_ms + vfs.io_stall_write_ms) DESC
  `);

  return result.recordset.map((row) => {
    const elapsedSec = row.elapsed_ms / 1000;
    return {
      databaseName: row.database_name,
      fileName: row.file_name,
      avgReadLatencyMs: row.avg_read_latency_ms,
      avgWriteLatencyMs: row.avg_write_latency_ms,
      currentReadLatencyMs: row.delta_reads > 0 ? Math.round((row.delta_read_stall_ms / row.delta_reads) * 100) / 100 : null,
      currentWriteLatencyMs: row.delta_writes > 0 ? Math.round((row.delta_write_stall_ms / row.delta_writes) * 100) / 100 : null,
      readIops: elapsedSec > 0 ? Math.round((row.delta_reads / elapsedSec) * 10) / 10 : null,
      writeIops: elapsedSec > 0 ? Math.round((row.delta_writes / elapsedSec) * 10) / 10 : null,
      readThroughputMBps: elapsedSec > 0 ? Math.round((row.delta_bytes_read / 1024 / 1024 / elapsedSec) * 100) / 100 : null,
      writeThroughputMBps: elapsedSec > 0 ? Math.round((row.delta_bytes_written / 1024 / 1024 / elapsedSec) * 100) / 100 : null,
    };
  });
}
