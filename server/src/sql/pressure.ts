import { getPool } from "../db";

export interface PressureStats {
  signalWaitPercent: number | null;
  pageLifeExpectancy: number | null;
  bufferCacheHitRatio: number | null;
  pendingMemoryGrants: number;
}

// signalWaitPercent is the classic CPU-pressure indicator: the share of total wait time spent
// waiting for a CPU to become available (signal wait) rather than waiting on a resource. High
// (>20-25%) means the server is CPU-bound, not I/O- or lock-bound.
export async function getPressureStats(): Promise<PressureStats> {
  const pool = getPool();

  const [signalWaits, counters, memoryGrants] = await Promise.all([
    pool.request().query(`
      SELECT
        CAST(SUM(signal_wait_time_ms) AS DECIMAL(20, 2)) AS signal_wait_ms,
        CAST(SUM(wait_time_ms) AS DECIMAL(20, 2)) AS total_wait_ms
      FROM sys.dm_os_wait_stats
      WHERE wait_time_ms > 0
    `),
    pool.request().query(`
      SELECT counter_name, cntr_value
      FROM sys.dm_os_performance_counters
      WHERE counter_name IN ('Buffer cache hit ratio', 'Buffer cache hit ratio base', 'Page life expectancy')
    `),
    pool.request().query(`
      SELECT COUNT(*) AS pending_grants
      FROM sys.dm_exec_query_memory_grants
      WHERE grant_time IS NULL
    `),
  ]);

  const counterRows = counters.recordset as { counter_name: string; cntr_value: number }[];
  const getCounter = (name: string) => counterRows.find((r) => r.counter_name.trim() === name)?.cntr_value ?? null;

  const hitRatio = getCounter("Buffer cache hit ratio");
  const hitRatioBase = getCounter("Buffer cache hit ratio base");
  const bufferCacheHitRatio =
    hitRatio !== null && hitRatioBase !== null && hitRatioBase !== 0
      ? Math.round((hitRatio / hitRatioBase) * 10000) / 100
      : null;

  const signalRow = signalWaits.recordset[0] as { signal_wait_ms: number; total_wait_ms: number };
  const signalWaitPercent =
    signalRow.total_wait_ms > 0 ? Math.round((signalRow.signal_wait_ms / signalRow.total_wait_ms) * 10000) / 100 : null;

  return {
    signalWaitPercent,
    pageLifeExpectancy: getCounter("Page life expectancy"),
    bufferCacheHitRatio,
    pendingMemoryGrants: (memoryGrants.recordset[0] as { pending_grants: number }).pending_grants,
  };
}
