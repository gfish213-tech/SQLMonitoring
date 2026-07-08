import { getPool } from "../db";

export interface ConsumerRow {
  sessionId: number;
  loginName: string;
  hostName: string | null;
  programName: string | null;
  databaseName: string | null;
  command: string | null;
  cpuTimeMs: number;
  logicalReads: number;
  physicalReads: number;
  writes: number;
  elapsedMs: number;
  waitType: string | null;
  blockingSessionId: number | null;
  tempdbMb: number | null;
  memoryGrantMb: number | null;
  memoryGrantPending: boolean;
  queryText: string | null;
}

// What's actually consuming resources right now, ranked by current request CPU time (not
// cumulative since restart) — this is "what's making the server slow right now", not history.
// logical_reads (buffer-pool page touches, includes cache hits) was already here; physical_reads
// (r.reads) is the actual disk-read count — the one that points at who's really driving disk IO,
// as distinct from who's just touching a lot of already-cached pages.
export async function getCurrentConsumers(): Promise<ConsumerRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT TOP 20
      r.session_id,
      s.login_name,
      s.host_name,
      s.program_name,
      DB_NAME(r.database_id) AS database_name,
      r.command,
      r.cpu_time AS cpu_time_ms,
      r.logical_reads,
      r.reads AS physical_reads,
      r.writes,
      r.total_elapsed_time AS elapsed_ms,
      r.wait_type,
      NULLIF(r.blocking_session_id, 0) AS blocking_session_id,
      tsu.tempdb_mb,
      mg.granted_memory_kb,
      mg.requested_memory_kb,
      mg.grant_time,
      qt.text AS query_text
    FROM sys.dm_exec_requests r
    INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
    OUTER APPLY (
      SELECT
        CAST(SUM(u.user_objects_alloc_page_count + u.internal_objects_alloc_page_count
          - u.user_objects_dealloc_page_count - u.internal_objects_dealloc_page_count) * 8.0 / 1024 AS DECIMAL(10, 2))
        AS tempdb_mb
      FROM sys.dm_db_session_space_usage u
      WHERE u.session_id = r.session_id
    ) tsu
    -- Most requests never need a workspace memory grant (sorts/hashes/large joins do); this is
    -- NULL for the common case, which the client renders as "-", not a bug.
    OUTER APPLY (
      SELECT TOP 1 g.granted_memory_kb, g.requested_memory_kb, g.grant_time
      FROM sys.dm_exec_query_memory_grants g
      WHERE g.session_id = r.session_id
    ) mg
    WHERE r.session_id <> @@SPID
    ORDER BY r.cpu_time DESC
  `);

  return result.recordset.map((row) => ({
    sessionId: row.session_id,
    loginName: row.login_name,
    hostName: row.host_name,
    programName: row.program_name,
    databaseName: row.database_name,
    command: row.command,
    cpuTimeMs: row.cpu_time_ms,
    logicalReads: row.logical_reads,
    physicalReads: row.physical_reads,
    writes: row.writes,
    elapsedMs: row.elapsed_ms,
    waitType: row.wait_type,
    blockingSessionId: row.blocking_session_id,
    tempdbMb: row.tempdb_mb,
    // If granted, show the granted amount; if still waiting on one, show what it's asking for
    // (memoryGrantPending distinguishes the two in the UI) - either way this is one figure to
    // scan for "who's holding/wanting a big chunk of workspace memory right now".
    memoryGrantMb:
      row.granted_memory_kb != null
        ? Math.round((row.granted_memory_kb / 1024) * 100) / 100
        : row.requested_memory_kb != null
          ? Math.round((row.requested_memory_kb / 1024) * 100) / 100
          : null,
    memoryGrantPending: row.grant_time === null && row.requested_memory_kb != null,
    queryText: row.query_text,
  }));
}
