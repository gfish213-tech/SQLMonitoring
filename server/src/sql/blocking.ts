import { getPool } from "../db";

export interface BlockingRow {
  sessionId: number;
  blockingSessionId: number;
  waitType: string | null;
  waitTimeMs: number;
  waitResource: string | null;
  loginName: string | null;
  hostName: string | null;
  databaseName: string | null;
  queryText: string | null;
}

export async function getBlockingChains(): Promise<BlockingRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      r.session_id,
      r.blocking_session_id,
      r.wait_type,
      r.wait_time AS wait_time_ms,
      r.wait_resource,
      s.login_name,
      s.host_name,
      DB_NAME(r.database_id) AS database_name,
      qt.text AS query_text
    FROM sys.dm_exec_requests r
    INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
    WHERE r.blocking_session_id <> 0
    ORDER BY r.wait_time DESC
  `);

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    blockingSessionId: row.blocking_session_id,
    waitType: row.wait_type,
    waitTimeMs: row.wait_time_ms,
    waitResource: row.wait_resource,
    loginName: row.login_name,
    hostName: row.host_name,
    databaseName: row.database_name,
    queryText: row.query_text,
  }));
}
