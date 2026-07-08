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
//
// Filtering out "benign" waits by hand-listing wait type names doesn't scale - SQL Server has
// dozens of internal background wait types (Hekaton/XTP, HADR, full-text, Service Broker,
// checkpoint, lazy writer, etc.) and grows more every version. Every one of them belongs to a
// SQL Server *system* worker task, not a user request, so the robust filter is
// sys.dm_exec_sessions.is_user_process = 1 - it excludes the whole category at once (this is
// exactly what was slipping through before: rows like WAIT_XTP_HOST_WAIT / PVS_PREALLOCATE /
// FT_IFTSHC_MUTEX / HADR_NOTIFICATION_DEQUEUE / BROKER_TRANSMITTER / KSOURCE_WAKEUP /
// ONDEMAND_TASK_QUEUE / CHECKPOINT_QUEUE / XE_TIMER_EVENT / DIRTY_PAGE_POLL, always present with
// waits measured in days since restart, drowning out anything a real incident would show). The
// explicit name-based exclusions below are now just a second layer for waits a genuine user
// session can still generate that aren't diagnostically interesting (this app's own 1-second
// WAITFOR DELAY sampling in overview.ts/pressure.ts, and a handful of Service Broker/XE
// internals that can appear on user sessions using those features directly).
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
    INNER JOIN sys.dm_exec_sessions s ON s.session_id = wt.session_id AND s.is_user_process = 1
    INNER JOIN sys.dm_exec_requests r ON r.session_id = wt.session_id
    WHERE wt.session_id > 0
      AND wt.wait_type <> 'WAITFOR'
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
