import { getPool, getActiveConnectionMeta, extractDriverError } from "../db";

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

// sys.query_store_runtime_stats is keyed by plan_id, not query_id - query_id only exists on
// sys.query_store_plan (which maps plan_id -> query_id) and sys.query_store_query. Joining
// through query_store_plan here is what makes "one query_id can appear more than once in the
// same interval when it has multiple plans" (parameter sniffing, plan flips) an actual possibility
// worth collapsing below, not just a comment - interval_stats aggregates to one execution-weighted
// average per (query_id, interval) first, so ranking by start_time compares whole intervals, not
// a coin flip between two same-time rows. rn = 1 is the most recent interval; rn 2-6 is that same
// query's own recent history (roughly the last several hours at the default 60-minute
// interval_length_minutes) - a query is judged regressed against itself, not a fixed threshold,
// so a query that's always been slow doesn't fire, and a fast query that got 3x slower does.
const REGRESSION_QUERY = `
;WITH interval_stats AS (
  SELECT
    p.query_id,
    rsi.start_time,
    SUM(rs.avg_duration * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS interval_avg_duration,
    SUM(rs.avg_cpu_time * rs.count_executions) / NULLIF(SUM(rs.count_executions), 0) AS interval_avg_cpu,
    SUM(rs.count_executions) AS interval_executions
  FROM sys.query_store_runtime_stats rs
  INNER JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
  INNER JOIN sys.query_store_runtime_stats_interval rsi
    ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
  WHERE rs.execution_type = 0
    AND rsi.start_time > DATEADD(HOUR, -24, GETUTCDATE())
  GROUP BY p.query_id, rsi.start_time
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

export interface QueryStoreDatabaseFailure {
  database: string;
  error: string;
}

export interface QueryStoreRegressionsResult {
  regressions: QueryStoreRegression[];
  databaseCount: number;
  failedDatabases: QueryStoreDatabaseFailure[];
}

async function getRegressionsForDatabase(dbName: string, originalDb: string): Promise<QueryStoreRegression[]> {
  const pool = getPool();
  const request = pool.request();
  // A heavy database (lots of distinct queries tracked in Query Store) can make the window-
  // function scan below take a while - msnodesqlv8's Request implementation has no per-request
  // timeout override (unlike the base tedious-backed mssql driver), so the headroom for that
  // comes from the pool-wide requestTimeout in db.ts, not from anything set here.
  // TRY/CATCH inside the batch (rather than just a JS try/catch around the whole call) guarantees
  // the final USE runs even when the regression query itself errors or times out mid-batch -
  // without it, an error partway through would stop the batch before reaching "USE [original]",
  // leaving whichever pooled connection handled this call parked on the wrong database for
  // whatever unrelated query runs on it next (the exact bug tempdb.ts's own comments describe
  // FILEPROPERTY hitting from the opposite direction). THROW re-raises after the context is
  // restored, so the caller still sees the failure - it's the connection state, not the error
  // itself, that this is protecting.
  const result = await request.query(`
    USE ${quoteIdent(dbName)};
    BEGIN TRY
      ${REGRESSION_QUERY}
    END TRY
    BEGIN CATCH
      DECLARE @qsErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
      USE ${quoteIdent(originalDb)};
      THROW 50000, @qsErrMsg, 1;
    END CATCH
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
}

// Query Store is enabled per-database (unlike every other DMV this app reads, which is
// server-wide) - is_query_store_on tells us which databases to even bother checking.
// databaseCount/failedDatabases exist so an empty regressions list is never ambiguous between
// "checked N databases, nothing regressed" and "every database silently failed to check" (e.g. a
// timeout on a heavy database used to just return [] like a clean result - see REQUEST_TIMEOUT_MS
// above and getRegressionsForDatabase's TRY/CATCH for the actual fix; this is what surfaces it).
export async function getQueryStoreRegressions(): Promise<QueryStoreRegressionsResult> {
  const pool = getPool();
  const originalDb = getActiveConnectionMeta()?.database ?? "master";

  let dbNames: string[];
  try {
    const dbResult = await pool.request().query(`
      SELECT name FROM sys.databases WHERE is_query_store_on = 1 AND state = 0
    `);
    dbNames = dbResult.recordset.map((row) => row.name as string);
  } catch {
    return { regressions: [], databaseCount: 0, failedDatabases: [] };
  }

  const settled = await Promise.allSettled(dbNames.map((name) => getRegressionsForDatabase(name, originalDb)));
  const regressions: QueryStoreRegression[] = [];
  const failedDatabases: QueryStoreDatabaseFailure[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      regressions.push(...outcome.value);
    } else {
      // Same driver quirk db.ts's own connect-time errors have to work around: msnodesqlv8
      // reports query errors as plain objects, not Error instances, so a bare .message here would
      // often just show "[object Object]" instead of the actual T-SQL error text - exactly the
      // kind of silent non-answer this whole failedDatabases mechanism exists to avoid.
      failedDatabases.push({ database: dbNames[i], error: extractDriverError(outcome.reason).message });
    }
  });

  return {
    // Capped, unlike Consumers - Query Store history isn't naturally bounded by "currently
    // executing" the way sys.dm_exec_requests is, so a busy multi-database server could otherwise
    // return hundreds of rows.
    regressions: regressions.sort((a, b) => b.regressionRatio - a.regressionRatio).slice(0, 25),
    databaseCount: dbNames.length,
    failedDatabases,
  };
}
