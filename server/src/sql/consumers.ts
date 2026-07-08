import { getPool } from "../db";
import { CURRENT_STATEMENT_SELECT, formatQueryText } from "./statementText";

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

// What's actually consuming resources right now (not cumulative since restart) — this is "what's
// making the server slow right now", not history.
//
// No TOP N / row cap: sys.dm_exec_requests only has a row per request that is *currently
// executing* - idle/sleeping sessions never appear here at all - so this is already bounded by
// real concurrent work (in practice capped by CPU core count / max worker threads), not by total
// connections. An artificial cap on top of that natural bound is what caused the original bug
// (a session heavy on IO or memory but not CPU could fall outside a "TOP 20 by cpu_time" and never
// even be fetched, so no client-side sort could surface it) - simplest fix is to not cap it at
// all and let the client sort/filter the full, already-small result set instead of trying to
// predict server-side which rows might matter.
export async function getCurrentConsumers(): Promise<ConsumerRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
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
      ${CURRENT_STATEMENT_SELECT}
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
    queryText: formatQueryText(row.proc_name, row.statement_text),
  }));
}
