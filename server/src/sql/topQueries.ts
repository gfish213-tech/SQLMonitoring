import { getPool } from "../db";

export type TopQueryMetric = "cpu" | "duration" | "reads" | "writes" | "executions";

const METRIC_TO_COLUMN: Record<TopQueryMetric, string> = {
  cpu: "total_worker_time",
  duration: "total_elapsed_time",
  reads: "total_logical_reads",
  writes: "total_logical_writes",
  executions: "execution_count",
};

export interface TopQueryRow {
  queryText: string;
  databaseName: string | null;
  executionCount: number;
  totalWorkerTimeMs: number;
  avgWorkerTimeMs: number;
  totalElapsedTimeMs: number;
  avgElapsedTimeMs: number;
  totalLogicalReads: number;
  avgLogicalReads: number;
  totalLogicalWrites: number;
  avgLogicalWrites: number;
  lastExecutionTime: string;
}

export async function getTopQueries(metric: TopQueryMetric, limit: number): Promise<TopQueryRow[]> {
  const orderColumn = METRIC_TO_COLUMN[metric];
  if (!orderColumn) {
    throw new Error(`Invalid metric: ${metric}`);
  }
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));

  const pool = getPool();
  const result = await pool.request().query(`
    SELECT TOP ${safeLimit}
      DB_NAME(qt.dbid) AS database_name,
      SUBSTRING(
        qt.text,
        (qs.statement_start_offset / 2) + 1,
        (
          (CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(qt.text)
            ELSE qs.statement_end_offset
          END - qs.statement_start_offset) / 2
        ) + 1
      ) AS query_text,
      qs.execution_count,
      qs.total_worker_time / 1000.0 AS total_worker_time_ms,
      (qs.total_worker_time / qs.execution_count) / 1000.0 AS avg_worker_time_ms,
      qs.total_elapsed_time / 1000.0 AS total_elapsed_time_ms,
      (qs.total_elapsed_time / qs.execution_count) / 1000.0 AS avg_elapsed_time_ms,
      qs.total_logical_reads,
      qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
      qs.total_logical_writes,
      qs.total_logical_writes / qs.execution_count AS avg_logical_writes,
      qs.last_execution_time
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
    WHERE qt.text IS NOT NULL
    ORDER BY qs.${orderColumn} DESC
  `);

  return result.recordset.map((row) => ({
    queryText: row.query_text,
    databaseName: row.database_name,
    executionCount: row.execution_count,
    totalWorkerTimeMs: row.total_worker_time_ms,
    avgWorkerTimeMs: row.avg_worker_time_ms,
    totalElapsedTimeMs: row.total_elapsed_time_ms,
    avgElapsedTimeMs: row.avg_elapsed_time_ms,
    totalLogicalReads: row.total_logical_reads,
    avgLogicalReads: row.avg_logical_reads,
    totalLogicalWrites: row.total_logical_writes,
    avgLogicalWrites: row.avg_logical_writes,
    lastExecutionTime: row.last_execution_time,
  }));
}
