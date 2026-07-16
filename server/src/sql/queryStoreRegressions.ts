import { getPool, getActiveConnectionMeta } from "../db";

export interface QueryStoreRegression {
  databaseName: string;
  queryId: number;
  queryText: string;
  recentAvgDurationMs: number;
  priorAvgDurationMs: number;
  recentAvgCpuMs: number;
  priorAvgCpuMs: number;
  regressionRatio: number;
  executionCount: number;
}

interface RawRegressionRow {
  query_id: number;
  recent_avg_duration_ms: number;
  prior_avg_duration_ms: number;
  recent_avg_cpu_ms: number;
  prior_avg_cpu_ms: number;
  regression_ratio: number;
  execution_count: number;
  query_text: string;
}

// A query that quietly got slower - with nothing else in the app (blocking, pressure, I/O)
// obviously explaining it - is one of the most common "it was fine yesterday" causes, and Query
// Store already tracks the history needed to spot it. Query Store is a per-database feature
// (unlike the server-wide DMVs the rest of this app reads), so this loops over every database
// that has it enabled - bounded by database count, not row count, unlike the per-row
// cross-database lookups indexStats.ts deliberately avoids.
function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

// One query_id can appear more than once in the same interval when it has multiple plans
// (parameter sniffing, plan flips); interval_stats collapses those into one execution-weighted
// average per (query_id, interval) first, so ranking by start_time compares whole intervals, not
// a coin flip between two same-time rows. rn = 1 is the most recent interval; rn 2-6 is that same
// query's own recent history (roughly the last several hours at the default 60-minute
// interval_length_minutes) - a query is judged regressed against itself, not a fixed threshold,
// so a query that's always been slow doesn't fire, and a fast query that got 3x slower does.
const REGRESSION_QUERY = `
;WITH interval_stats AS (
  SELECT
    rs.query_id,
    rsi.start_time,
    SUM(rs.avg_duration * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS interval_avg_duration,
    SUM(rs.avg_cpu_time * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS interval_avg_cpu,
    SUM(rs.count_executions) AS interval_executions
  FROM sys.query_store_runtime_stats rs
  INNER JOIN sys.query_store_runtime_stats_interval rsi
    ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
  WHERE rs.execution_type = 0
    AND rsi.start_time > DATEADD(HOUR, -24, GETUTCDATE())
  GROUP BY rs.query_id, rsi.start_time
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY query_id ORDER BY start_time DESC) AS rn
  FROM interval_stats
),
agg AS (
  SELECT
    query_id,
    MAX(CASE WHEN rn = 1 THEN interval_avg_duration END) AS recent_avg_duration,
    MAX(CASE WHEN rn = 1 THEN interval_avg_cpu END) AS recent_avg_cpu,
    MAX(CASE WHEN rn = 1 THEN interval_executions END) AS recent_executions,
    AVG(CASE WHEN rn BETWEEN 2 AND 6 THEN interval_avg_duration END) AS prior_avg_duration,
    AVG(CASE WHEN rn BETWEEN 2 AND 6 THEN interval_avg_cpu END) AS prior_avg_cpu,
    COUNT(CASE WHEN rn BETWEEN 2 AND 6 THEN 1 END) AS prior_interval_count
  FROM ranked
  GROUP BY query_id
)
SELECT TOP 25
  agg.query_id,
  agg.recent_avg_duration / 1000.0 AS recent_avg_duration_ms,
  agg.prior_avg_duration / 1000.0 AS prior_avg_duration_ms,
  agg.recent_avg_cpu / 1000.0 AS recent_avg_cpu_ms,
  agg.prior_avg_cpu / 1000.0 AS prior_avg_cpu_ms,
  agg.recent_avg_duration * 1.0 / NULLIF(agg.prior_avg_duration, 0) AS regression_ratio,
  agg.recent_executions AS execution_count,
  qt.query_sql_text AS query_text
FROM agg
INNER JOIN sys.query_store_query q ON q.query_id = agg.query_id
INNER JOIN sys.query_store_query_text qt ON qt.query_text_id = q.query_text_id
WHERE agg.prior_interval_count >= 2
  AND agg.recent_avg_duration >= 1000000
  AND agg.recent_avg_duration >= agg.prior_avg_duration * 3
ORDER BY regression_ratio DESC;
`;

async function getRegressionsForDatabase(dbName: string, originalDb: string): Promise<QueryStoreRegression[]> {
  const pool = getPool();
  try {
    // USE, the query, and USE back all run as one batch on whichever physical connection the
    // pool hands this call - splitting this across separate pool.request() calls can't guarantee
    // the same connection, which would leave a pooled connection parked on the wrong database
    // for whatever unrelated query runs on it next (the exact bug tempdb.ts's own comments
    // describe FILEPROPERTY hitting from the opposite direction).
    const result = await pool.request().query(`
      USE ${quoteIdent(dbName)};
      ${REGRESSION_QUERY}
      USE ${quoteIdent(originalDb)};
    `);
    return (result.recordset as RawRegressionRow[]).map((row) => ({
      databaseName: dbName,
      queryId: row.query_id,
      queryText: row.query_text,
      recentAvgDurationMs: row.recent_avg_duration_ms,
      priorAvgDurationMs: row.prior_avg_duration_ms,
      recentAvgCpuMs: row.recent_avg_cpu_ms,
      priorAvgCpuMs: row.prior_avg_cpu_ms,
      regressionRatio: row.regression_ratio,
      executionCount: row.execution_count,
    }));
  } catch {
    // Older compat level, Query Store in a transitioning state (e.g. READ_ONLY after hitting its
    // size cap), or a permissions hiccup on this one database shouldn't take down every other
    // database's results - same fail-soft-per-item shape as blocking.ts's per-lead-blocker work.
    return [];
  }
}

// Query Store is enabled per-database (unlike every other DMV this app reads, which is
// server-wide) - is_query_store_on tells us which databases to even bother checking.
export async function getQueryStoreRegressions(): Promise<QueryStoreRegression[]> {
  const pool = getPool();
  const originalDb = getActiveConnectionMeta()?.database ?? "master";

  let dbNames: string[];
  try {
    const dbResult = await pool.request().query(`
      SELECT name FROM sys.databases WHERE is_query_store_on = 1 AND state = 0
    `);
    dbNames = dbResult.recordset.map((row) => row.name as string);
  } catch {
    return [];
  }

  const perDatabase = await Promise.all(dbNames.map((name) => getRegressionsForDatabase(name, originalDb)));
  // Capped, unlike Consumers - Query Store history isn't naturally bounded by "currently
  // executing" the way sys.dm_exec_requests is, so a busy multi-database server could otherwise
  // return hundreds of rows.
  return perDatabase
    .flat()
    .sort((a, b) => b.regressionRatio - a.regressionRatio)
    .slice(0, 25);
}
