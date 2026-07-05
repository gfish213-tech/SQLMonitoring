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
}

export async function getOverview(): Promise<OverviewStats> {
  const pool = getPool();

  const [sysInfo, sessionCounts, counters] = await Promise.all([
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
      SELECT counter_name, cntr_value, object_name
      FROM sys.dm_os_performance_counters
      WHERE counter_name IN ('Buffer cache hit ratio', 'Buffer cache hit ratio base', 'Page life expectancy', 'Batch Requests/sec')
    `),
  ]);

  const counterRows = counters.recordset as { counter_name: string; cntr_value: number; object_name: string }[];
  const getCounter = (name: string) =>
    counterRows.find((r) => r.counter_name.trim() === name)?.cntr_value ?? null;

  const hitRatio = getCounter("Buffer cache hit ratio");
  const hitRatioBase = getCounter("Buffer cache hit ratio base");
  const bufferCacheHitRatio =
    hitRatio !== null && hitRatioBase !== null && hitRatioBase !== 0
      ? Math.round((hitRatio / hitRatioBase) * 10000) / 100
      : null;

  return {
    cpuCount: sysInfo.recordset[0].cpu_count,
    sqlServerStartTime: sysInfo.recordset[0].sqlserver_start_time,
    activeSessionCount: sessionCounts.recordset[0].active_session_count,
    activeRequestCount: sessionCounts.recordset[0].active_request_count,
    blockedRequestCount: sessionCounts.recordset[0].blocked_request_count,
    bufferCacheHitRatio,
    pageLifeExpectancy: getCounter("Page life expectancy"),
    batchRequestsPerSec: getCounter("Batch Requests/sec"),
  };
}
