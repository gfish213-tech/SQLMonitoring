import { getPool } from "../db";

export interface ActiveSessionRow {
  sessionId: number;
  loginName: string;
  hostName: string | null;
  programName: string | null;
  status: string;
  command: string | null;
  databaseName: string | null;
  cpuTimeMs: number;
  logicalReads: number;
  writes: number;
  waitType: string | null;
  waitTimeMs: number | null;
  blockingSessionId: number | null;
  totalElapsedTimeMs: number | null;
  queryText: string | null;
}

export async function getActiveSessions(): Promise<ActiveSessionRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      s.session_id,
      s.login_name,
      s.host_name,
      s.program_name,
      s.status,
      r.command,
      DB_NAME(r.database_id) AS database_name,
      s.cpu_time AS cpu_time_ms,
      s.logical_reads,
      s.writes,
      r.wait_type,
      r.wait_time AS wait_time_ms,
      r.blocking_session_id,
      r.total_elapsed_time AS total_elapsed_time_ms,
      qt.text AS query_text
    FROM sys.dm_exec_sessions s
    LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
    WHERE s.is_user_process = 1
    ORDER BY s.cpu_time DESC
  `);

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    loginName: row.login_name,
    hostName: row.host_name,
    programName: row.program_name,
    status: row.status,
    command: row.command,
    databaseName: row.database_name,
    cpuTimeMs: row.cpu_time_ms,
    logicalReads: row.logical_reads,
    writes: row.writes,
    waitType: row.wait_type,
    waitTimeMs: row.wait_time_ms,
    blockingSessionId: row.blocking_session_id || null,
    totalElapsedTimeMs: row.total_elapsed_time_ms,
    queryText: row.query_text,
  }));
}
