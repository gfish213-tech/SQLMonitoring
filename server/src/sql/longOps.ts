import { getPool } from "../db";
import { CURRENT_STATEMENT_SELECT, formatQueryText } from "./statementText";

export interface LongOpRow {
  sessionId: number;
  command: string;
  databaseName: string | null;
  percentComplete: number | null;
  startTime: string;
  estimatedCompletionTime: string | null;
  elapsedMs: number;
  loginName: string | null;
  queryText: string | null;
}

// Backups, restores, DBCC checks, and index rebuilds all report progress through
// sys.dm_exec_requests.percent_complete — this catches any of them in flight, not just backups.
export async function getLongRunningOps(): Promise<LongOpRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      r.session_id,
      r.command,
      DB_NAME(r.database_id) AS database_name,
      r.percent_complete,
      CONVERT(varchar(33), r.start_time, 126) AS start_time,
      CASE WHEN r.estimated_completion_time > 0
        THEN CONVERT(varchar(33), DATEADD(MILLISECOND, r.estimated_completion_time, GETDATE()), 126)
        ELSE NULL
      END AS estimated_completion_time,
      DATEDIFF(MILLISECOND, r.start_time, GETDATE()) AS elapsed_ms,
      s.login_name,
      ${CURRENT_STATEMENT_SELECT}
    FROM sys.dm_exec_requests r
    INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
    WHERE r.percent_complete > 0
       OR r.command IN ('BACKUP DATABASE', 'BACKUP LOG', 'RESTORE DATABASE', 'RESTORE LOG', 'DBCC CHECKDB', 'DBCC CHECKTABLE')
    ORDER BY r.start_time ASC
  `);

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    command: row.command,
    databaseName: row.database_name,
    percentComplete: row.percent_complete,
    startTime: row.start_time,
    estimatedCompletionTime: row.estimated_completion_time,
    elapsedMs: row.elapsed_ms,
    loginName: row.login_name,
    queryText: formatQueryText(row.proc_name, row.statement_text),
  }));
}
