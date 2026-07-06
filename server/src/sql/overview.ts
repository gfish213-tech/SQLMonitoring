import { getPool } from "../db";

export interface OverviewStats {
  cpuCount: number;
  sqlServerStartTime: string;
  activeSessionCount: number;
  activeRequestCount: number;
  blockedRequestCount: number;
  bufferCacheHitRatio: number | null;
  pageLifeExpectancy: number | null;
  batchRequestsPerSec: number | null;
  planCacheMb: number;
  adhocPlanCacheMb: number;
  adhocPlanCachePercent: number | null;
  singleUseAdhocPlanCount: number;
  singleUseAdhocPlanMb: number;
}

export async function getOverview(): Promise<OverviewStats> {
  const pool = getPool();

  // "Batch Requests/sec" and both "Buffer cache hit ratio" counters are cumulative since
  // restart (PERF_COUNTER_BULK_COUNT / ratio pairs), so their raw cntr_value is NOT a rate —
  // displaying it directly would show the total batches ever executed. Sample twice, one
  // second apart, and report the delta. Page life expectancy is a true gauge and needs no
  // sampling. The 1s WAITFOR runs in parallel with the other panels' queries, so it adds ~1s
  // to the combined refresh, not per-panel.
  const [sysInfo, sessionCounts, counters, planCache] = await Promise.all([
    pool.request().query(`
      SELECT cpu_count, sqlserver_start_time
      FROM sys.dm_os_sys_info
    `),
    pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS active_session_count,
        (SELECT COUNT(*) FROM sys.dm_exec_requests) AS active_request_count,
        (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0) AS blocked_request_count
    `),
    pool.request().query(`
      DECLARE @batch1 BIGINT, @hit1 BIGINT, @base1 BIGINT;

      SELECT
        @batch1 = MAX(CASE WHEN counter_name = 'Batch Requests/sec' THEN cntr_value END),
        @hit1 = MAX(CASE WHEN counter_name = 'Buffer cache hit ratio' AND object_name LIKE '%Buffer Manager%' THEN cntr_value END),
        @base1 = MAX(CASE WHEN counter_name = 'Buffer cache hit ratio base' AND object_name LIKE '%Buffer Manager%' THEN cntr_value END)
      FROM sys.dm_os_performance_counters
      WHERE counter_name IN ('Batch Requests/sec', 'Buffer cache hit ratio', 'Buffer cache hit ratio base');

      WAITFOR DELAY '00:00:01';

      SELECT
        MAX(CASE WHEN counter_name = 'Batch Requests/sec' THEN cntr_value END) - @batch1 AS batch_requests_per_sec,
        MAX(CASE WHEN counter_name = 'Buffer cache hit ratio' AND object_name LIKE '%Buffer Manager%' THEN cntr_value END) - @hit1 AS hit_delta,
        MAX(CASE WHEN counter_name = 'Buffer cache hit ratio base' AND object_name LIKE '%Buffer Manager%' THEN cntr_value END) - @base1 AS base_delta,
        MAX(CASE WHEN counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%' THEN cntr_value END) AS page_life_expectancy
      FROM sys.dm_os_performance_counters
      WHERE counter_name IN ('Batch Requests/sec', 'Buffer cache hit ratio', 'Buffer cache hit ratio base', 'Page life expectancy');
    `),
    // Ad-hoc, single-use plans (unparameterized SQL strings, not sp_executesql/stored procs)
    // pollute the plan cache with plans that will never be reused, stealing memory that could
    // otherwise hold data pages (directly competing with page life expectancy above).
    pool.request().query(`
      SELECT
        SUM(CAST(size_in_bytes AS BIGINT)) AS total_bytes,
        SUM(CASE WHEN objtype = 'Adhoc' THEN CAST(size_in_bytes AS BIGINT) ELSE 0 END) AS adhoc_bytes,
        SUM(CASE WHEN objtype = 'Adhoc' AND usecounts = 1 THEN CAST(size_in_bytes AS BIGINT) ELSE 0 END) AS single_use_adhoc_bytes,
        SUM(CASE WHEN objtype = 'Adhoc' AND usecounts = 1 THEN 1 ELSE 0 END) AS single_use_adhoc_count
      FROM sys.dm_exec_cached_plans
    `),
  ]);

  const c = counters.recordset[0] as {
    batch_requests_per_sec: number | null;
    hit_delta: number | null;
    base_delta: number | null;
    page_life_expectancy: number | null;
  };

  // base_delta = 0 means no page lookups happened during the sample second (idle server) —
  // there's no meaningful hit ratio to report for that instant.
  const bufferCacheHitRatio =
    c.hit_delta !== null && c.base_delta !== null && c.base_delta > 0
      ? Math.min(100, Math.round((c.hit_delta / c.base_delta) * 10000) / 100)
      : null;

  const p = planCache.recordset[0] as {
    total_bytes: number | null;
    adhoc_bytes: number | null;
    single_use_adhoc_bytes: number | null;
    single_use_adhoc_count: number | null;
  };
  const totalBytes = p.total_bytes ?? 0;
  const adhocBytes = p.adhoc_bytes ?? 0;

  return {
    cpuCount: sysInfo.recordset[0].cpu_count,
    sqlServerStartTime: sysInfo.recordset[0].sqlserver_start_time,
    activeSessionCount: sessionCounts.recordset[0].active_session_count,
    activeRequestCount: sessionCounts.recordset[0].active_request_count,
    blockedRequestCount: sessionCounts.recordset[0].blocked_request_count,
    bufferCacheHitRatio,
    pageLifeExpectancy: c.page_life_expectancy,
    batchRequestsPerSec: c.batch_requests_per_sec !== null && c.batch_requests_per_sec >= 0 ? c.batch_requests_per_sec : null,
    planCacheMb: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
    adhocPlanCacheMb: Math.round((adhocBytes / 1024 / 1024) * 100) / 100,
    adhocPlanCachePercent: totalBytes > 0 ? Math.round((adhocBytes / totalBytes) * 10000) / 100 : null,
    singleUseAdhocPlanCount: p.single_use_adhoc_count ?? 0,
    singleUseAdhocPlanMb: Math.round(((p.single_use_adhoc_bytes ?? 0) / 1024 / 1024) * 100) / 100,
  };
}
