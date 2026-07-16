import { getPool } from "../db";

export interface PressureStats {
  signalWaitPercent: number | null;
  pageLifeExpectancy: number | null;
  bufferCacheHitRatio: number | null;
  pendingMemoryGrants: number;
  runnableTasksCount: number;
  workQueueCount: number;
}

// Background/housekeeping waits that accumulate constantly whether or not anything is wrong.
// They must be excluded from a 1-second delta or they drown out the signal — including WAITFOR,
// which this module's own sampling delay would otherwise add to the total.
const BENIGN_WAITS = `
  'BROKER_EVENTHANDLER','BROKER_RECEIVE_WAITFOR','BROKER_TASK_STOP','BROKER_TO_FLUSH','BROKER_TRANSMITTER',
  'CHECKPOINT_QUEUE','CLR_AUTO_EVENT','CLR_MANUAL_EVENT','CLR_SEMAPHORE','DBMIRROR_DBM_EVENT',
  'DBMIRROR_EVENTS_QUEUE','DBMIRROR_WORKER_QUEUE','DBMIRRORING_CMD','DIRTY_PAGE_POLL','DISPATCHER_QUEUE_SEMAPHORE',
  'FT_IFTS_SCHEDULER_IDLE_WAIT','FT_IFTSHC_MUTEX','HADR_CLUSAPI_CALL','HADR_FILESTREAM_IOMGR_IOCOMPLETION',
  'HADR_LOGCAPTURE_WAIT','HADR_NOTIFICATION_DEQUEUE','HADR_TIMER_TASK','HADR_WORK_QUEUE','LAZYWRITER_SLEEP',
  'LOGMGR_QUEUE','ONDEMAND_TASK_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH','SLEEP_SYSTEMTASK','SLEEP_TASK',
  'SP_SERVER_DIAGNOSTICS_SLEEP','SQLTRACE_BUFFER_FLUSH','SQLTRACE_INCREMENTAL_FLUSH_SLEEP','WAITFOR',
  'XE_DISPATCHER_JOIN','XE_DISPATCHER_WAIT','XE_TIMER_EVENT'
`;

// signalWaitPercent is the classic CPU-pressure indicator: the share of total wait time spent
// waiting for a CPU to become available (signal wait) rather than waiting on a resource. High
// (>20-25%) means the server is CPU-bound, not I/O- or lock-bound.
//
// sys.dm_os_wait_stats (and the buffer counters) are cumulative since restart, so on a server
// that's been up for months the lifetime ratio can't reflect what's happening *right now* — a
// live CPU storm barely moves it, and old history can keep it permanently elevated. Sample
// twice, one second apart, and report the delta: what the last second actually looked like.
export async function getPressureStats(): Promise<PressureStats> {
  const pool = getPool();

  const [sampled, memoryGrants, schedulers] = await Promise.all([
    pool.request().query(`
      DECLARE @signal1 BIGINT, @total1 BIGINT, @hit1 BIGINT, @base1 BIGINT;

      SELECT @signal1 = SUM(signal_wait_time_ms), @total1 = SUM(wait_time_ms)
      FROM sys.dm_os_wait_stats
      WHERE wait_type NOT IN (${BENIGN_WAITS});

      SELECT
        @hit1 = MAX(CASE WHEN counter_name = 'Buffer cache hit ratio' THEN cntr_value END),
        @base1 = MAX(CASE WHEN counter_name = 'Buffer cache hit ratio base' THEN cntr_value END)
      FROM sys.dm_os_performance_counters
      WHERE object_name LIKE '%Buffer Manager%';

      WAITFOR DELAY '00:00:01';

      SELECT
        (SELECT SUM(signal_wait_time_ms) FROM sys.dm_os_wait_stats WHERE wait_type NOT IN (${BENIGN_WAITS})) - @signal1 AS signal_wait_ms,
        (SELECT SUM(wait_time_ms) FROM sys.dm_os_wait_stats WHERE wait_type NOT IN (${BENIGN_WAITS})) - @total1 AS total_wait_ms,
        (SELECT MAX(CASE WHEN counter_name = 'Buffer cache hit ratio' THEN cntr_value END)
           FROM sys.dm_os_performance_counters WHERE object_name LIKE '%Buffer Manager%') - @hit1 AS hit_delta,
        (SELECT MAX(CASE WHEN counter_name = 'Buffer cache hit ratio base' THEN cntr_value END)
           FROM sys.dm_os_performance_counters WHERE object_name LIKE '%Buffer Manager%') - @base1 AS base_delta,
        (SELECT MAX(CASE WHEN counter_name = 'Page life expectancy' THEN cntr_value END)
           FROM sys.dm_os_performance_counters WHERE object_name LIKE '%Buffer Manager%') AS page_life_expectancy;
    `),
    pool.request().query(`
      SELECT COUNT(*) AS pending_grants
      FROM sys.dm_exec_query_memory_grants
      WHERE grant_time IS NULL
    `),
    // runnable_tasks_count > 0 means a task is ready to run but waiting for a CPU core - true
    // worker/scheduler pressure, distinct from signal_wait_percent (which is wait-time-based
    // and needs a sample window). work_queue_count > 0 is more serious: SQL Server has run out
    // of worker threads and new requests are queuing before they even get a worker assigned.
    //
    // sys.dm_os_schedulers.runnable_tasks_count (the obvious column for this) counts *every*
    // runnable task per scheduler, including SQL Server's own internal background workers (lazy
    // writer, checkpoint, ghost cleanup, etc.) - it can read e.g. "4" while the Consumers tab
    // shows only 1-2 user sessions, with no way to tell from this number alone whether that's
    // real user-driven CPU pressure or just background housekeeping. Joining sys.dm_os_tasks (the
    // per-task detail, unlike dm_os_schedulers' pre-aggregated counts) to sys.dm_exec_sessions and
    // filtering is_user_process = 1 - the same technique currentWaits.ts uses for the same reason
    // - counts only tasks actually driven by a user request. work_queue_count isn't filtered the
    // same way: it's a genuine capacity signal (SQL Server ran out of worker threads entirely),
    // not tied to any specific session the way a runnable task is.
    pool.request().query(`
      SELECT
        (SELECT COUNT(*)
         FROM sys.dm_os_tasks t
         INNER JOIN sys.dm_exec_sessions s ON s.session_id = t.session_id AND s.is_user_process = 1
         WHERE t.task_state = 'RUNNABLE') AS runnable_tasks_count,
        (SELECT SUM(work_queue_count) FROM sys.dm_os_schedulers WHERE status = 'VISIBLE ONLINE') AS work_queue_count
    `),
  ]);

  const row = sampled.recordset[0] as {
    signal_wait_ms: number | null;
    total_wait_ms: number | null;
    hit_delta: number | null;
    base_delta: number | null;
    page_life_expectancy: number | null;
  };

  // No non-benign waits in the sample second = an idle (or purely CPU-running) server; there's
  // no wait profile to compute a percentage from.
  const signalWaitPercent =
    row.signal_wait_ms !== null && row.total_wait_ms !== null && row.total_wait_ms > 0
      ? Math.min(100, Math.round((row.signal_wait_ms / row.total_wait_ms) * 10000) / 100)
      : null;

  const bufferCacheHitRatio =
    row.hit_delta !== null && row.base_delta !== null && row.base_delta > 0
      ? Math.min(100, Math.round((row.hit_delta / row.base_delta) * 10000) / 100)
      : null;

  const s = schedulers.recordset[0] as { runnable_tasks_count: number | null; work_queue_count: number | null };

  return {
    signalWaitPercent,
    pageLifeExpectancy: row.page_life_expectancy,
    bufferCacheHitRatio,
    pendingMemoryGrants: (memoryGrants.recordset[0] as { pending_grants: number }).pending_grants,
    runnableTasksCount: s.runnable_tasks_count ?? 0,
    workQueueCount: s.work_queue_count ?? 0,
  };
}
