import { getPool } from "../db";

export interface WaitStatRow {
  waitType: string;
  waitTimeMs: number;
  waitingTasksCount: number;
  avgWaitTimeMs: number;
  signalWaitTimeMs: number;
}

// Wait types that are almost always benign background waits and clutter the results.
const IGNORED_WAIT_TYPES = [
  "CLR_SEMAPHORE", "LAZYWRITER_SLEEP", "RESOURCE_QUEUE", "SLEEP_TASK",
  "SLEEP_SYSTEMTASK", "SQLTRACE_BUFFER_FLUSH", "WAITFOR", "LOGMGR_QUEUE",
  "CHECKPOINT_QUEUE", "REQUEST_FOR_DEADLOCK_SEARCH", "XE_TIMER_EVENT",
  "BROKER_TO_FLUSH", "BROKER_TASK_STOP", "CLR_MANUAL_EVENT", "CLR_AUTO_EVENT",
  "DISPATCHER_QUEUE_SEMAPHORE", "FT_IFTS_SCHEDULER_IDLE_WAIT", "XE_DISPATCHER_WAIT",
  "XE_DISPATCHER_JOIN", "SQLTRACE_INCREMENTAL_FLUSH_SLEEP", "BROKER_EVENTHANDLER",
  "TRACEWRITE", "BROKER_RECEIVE_WAITFOR", "ONDEMAND_TASK_QUEUE",
  "DBMIRROREVENTS_QUEUE", "DBMIRRORING_CMD", "BROKER_TRANSMITTER",
  "SQLTRACE_WAIT_ENTRIES", "SP_SERVER_DIAGNOSTICS_SLEEP",
];

export async function getTopWaitStats(limit: number): Promise<WaitStatRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT TOP ${safeLimit}
      wait_type,
      wait_time_ms,
      waiting_tasks_count,
      signal_wait_time_ms
    FROM sys.dm_os_wait_stats
    WHERE wait_time_ms > 0
      AND wait_type NOT IN ('${IGNORED_WAIT_TYPES.join("','")}')
    ORDER BY wait_time_ms DESC
  `);

  return result.recordset.map((row) => ({
    waitType: row.wait_type,
    waitTimeMs: row.wait_time_ms,
    waitingTasksCount: row.waiting_tasks_count,
    avgWaitTimeMs: row.waiting_tasks_count > 0 ? Math.round((row.wait_time_ms / row.waiting_tasks_count) * 100) / 100 : 0,
    signalWaitTimeMs: row.signal_wait_time_ms,
  }));
}
