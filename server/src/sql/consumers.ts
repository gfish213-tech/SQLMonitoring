import { getPool } from "../db";

export interface ConsumerRow {
  sessionId: number;
  loginName: string;
  hostName: string | null;
  programName: string | null;
  databaseName: string | null;
  command: string | null;
  cpuTimeMs: number;
  logicalReads: number;
  writes: number;
  elapsedMs: number;
  waitType: string | null;
  blockingSessionId: number | null;
  tempdbMb: number | null;
  queryText: string | null;
}

// What's actually consuming resources right now, ranked by current request CPU time (not
// cumulative since restart) — this is "what's making the server slow right now", not history.
export async function getCurrentConsumers(): Promise<ConsumerRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      r.session_id,
      s.login_name,
      s.host_name,
      s.program_name,
      DB_NAME(r.database_id) AS database_name,
      r.command,
      r.cpu_time AS cpu_time_ms,
      r.logical_reads,
      r.writes,
      r.total_elapsed_time AS elapsed_ms,
      r.wait_type,
      NULLIF(r.blocking_session_id, 0) AS blocking_session_id,
      tsu.tempdb_mb,
      qt.text AS query_text
    FROM sys.dm_exec_requests r
    INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
    OUTER APPLY (
      SELECT
        CAST(SUM(u.user_objects_alloc_page_count + u.internal_objects_alloc_page_count
          - u.user_objects_dealloc_page_count - u.internal_objects_dealloc_page_count) * 8.0 / 1024 AS DECIMAL(10, 2))
        AS tempdb_mb
      FROM sys.dm_db_session_space_usage u
      WHERE u.session_id = r.session_id
    ) tsu
    WHERE r.session_id <> @@SPID
    ORDER BY r.cpu_time DESC
  `);

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    loginName: row.login_name,
    hostName: row.host_name,
    programName: row.program_name,
    databaseName: row.database_name,
    command: row.command,
    cpuTimeMs: row.cpu_time_ms,
    logicalReads: row.logical_reads,
    writes: row.writes,
    elapsedMs: row.elapsed_ms,
    waitType: row.wait_type,
    blockingSessionId: row.blocking_session_id,
    tempdbMb: row.tempdb_mb,
    queryText: row.query_text,
  }));
}
