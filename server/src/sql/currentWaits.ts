import { getPool } from "../db";

export interface CurrentWaitRow {
  sessionId: number;
  waitType: string;
  waitDurationMs: number;
  resourceDescription: string | null;
  databaseName: string | null;
}

// sys.dm_os_waiting_tasks is instantaneous — what every currently-executing task is waiting on
// right now, as opposed to sys.dm_os_wait_stats which is a cumulative total since the last
// restart (already covered by DBADash's trend monitoring, not needed here).
export async function getCurrentWaits(): Promise<CurrentWaitRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      wt.session_id,
      wt.wait_type,
      wt.wait_duration_ms,
      wt.resource_description,
      DB_NAME(r.database_id) AS database_name
    FROM sys.dm_os_waiting_tasks wt
    INNER JOIN sys.dm_exec_requests r ON r.session_id = wt.session_id
    WHERE wt.session_id > 0
      AND wt.wait_type NOT LIKE '%SLEEP%'
      AND wt.wait_type NOT IN ('BROKER_TASK_STOP', 'BROKER_TO_FLUSH', 'BROKER_EVENTHANDLER', 'XE_DISPATCHER_WAIT', 'REQUEST_FOR_DEADLOCK_SEARCH')
    ORDER BY wt.wait_duration_ms DESC
  `);

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    waitType: row.wait_type,
    waitDurationMs: row.wait_duration_ms,
    resourceDescription: row.resource_description,
    databaseName: row.database_name,
  }));
}
