import { getPool } from "../db";

export interface BlockedSession {
  sessionId: number;
  blockedBy: number;
  waitType: string | null;
  waitTimeMs: number;
  waitResource: string | null;
  loginName: string | null;
  databaseName: string | null;
  queryText: string | null;
}

export interface LeadBlocker {
  sessionId: number;
  loginName: string | null;
  hostName: string | null;
  programName: string | null;
  status: string;
  isIdleWithOpenTransaction: boolean;
  openTransactionCount: number;
  lastStatementText: string | null;
  lastRequestEndTime: string | null;
  databaseName: string | null;
  blockedSessions: BlockedSession[];
}

interface WaiterRow {
  session_id: number;
  blocking_session_id: number;
  wait_type: string | null;
  wait_time_ms: number;
  wait_resource: string | null;
  login_name: string | null;
  database_name: string | null;
  query_text: string | null;
}

interface BlockerRow {
  session_id: number;
  login_name: string | null;
  host_name: string | null;
  program_name: string | null;
  status: string;
  open_transaction_count: number;
  last_request_end_time: string | null;
  database_name: string | null;
  last_statement_text: string | null;
}

// Every session currently waiting on another session (the classic blocking view).
async function getWaiters() {
  const pool = getPool();
  const result = await pool.request().query<WaiterRow>(`
    SELECT
      r.session_id,
      r.blocking_session_id,
      r.wait_type,
      r.wait_time AS wait_time_ms,
      r.wait_resource,
      s.login_name,
      DB_NAME(r.database_id) AS database_name,
      qt.text AS query_text
    FROM sys.dm_exec_requests r
    INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
    WHERE r.blocking_session_id <> 0
  `);
  return result.recordset;
}

// Session info for every distinct blocker, whether it's actively running a request or sitting
// idle with an open transaction (the classic "app didn't commit/rollback" cause of blocking).
async function getBlockerSessions(blockerIds: number[]) {
  if (blockerIds.length === 0) return [];
  const pool = getPool();
  const idList = blockerIds.join(",");
  const result = await pool.request().query<BlockerRow>(`
    SELECT
      s.session_id,
      s.login_name,
      s.host_name,
      s.program_name,
      s.status,
      s.open_transaction_count,
      CONVERT(varchar(33), s.last_request_end_time, 126) AS last_request_end_time,
      DB_NAME(qt.dbid) AS database_name,
      qt.text AS last_statement_text
    FROM sys.dm_exec_sessions s
    LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
    OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) qt
    WHERE s.session_id IN (${idList})
  `);
  return result.recordset;
}

// Everyone stuck behind a lead blocker, including indirect victims: in a chain A <- B <- C,
// C waits on B (not on A directly), but A is still the root cause of C being stuck. A naive
// "waiters where blocking_session_id = lead" drops C entirely and understates the blast
// radius. BFS from the lead through the waiter graph; direct waiters come out first.
function collectChainWaiters(leadId: number, waitersByBlocker: Map<number, WaiterRow[]>): WaiterRow[] {
  const chain: WaiterRow[] = [];
  const visited = new Set<number>([leadId]);
  const queue = [leadId];

  while (queue.length > 0) {
    const blockerId = queue.shift()!;
    for (const waiter of waitersByBlocker.get(blockerId) ?? []) {
      if (visited.has(waiter.session_id)) continue;
      visited.add(waiter.session_id);
      chain.push(waiter);
      queue.push(waiter.session_id);
    }
  }

  return chain;
}

export async function getBlockingChains(): Promise<LeadBlocker[]> {
  const waiters = await getWaiters();
  if (waiters.length === 0) return [];

  const waiterIds = new Set(waiters.map((w) => w.session_id));
  const blockerIds = [...new Set(waiters.map((w) => w.blocking_session_id))];
  const blockers = await getBlockerSessions(blockerIds);

  const waitersByBlocker = new Map<number, WaiterRow[]>();
  for (const w of waiters) {
    const list = waitersByBlocker.get(w.blocking_session_id);
    if (list) list.push(w);
    else waitersByBlocker.set(w.blocking_session_id, [w]);
  }

  // A "lead" blocker is one that isn't itself waiting on someone else — the actual root cause.
  const leadBlockerIds = blockerIds.filter((id) => !waiterIds.has(id));

  return leadBlockerIds.map((leadId) => {
    const blockerInfo = blockers.find((b) => b.session_id === leadId);
    const chainWaiters = collectChainWaiters(leadId, waitersByBlocker);

    return {
      sessionId: leadId,
      loginName: blockerInfo?.login_name ?? null,
      hostName: blockerInfo?.host_name ?? null,
      programName: blockerInfo?.program_name ?? null,
      status: blockerInfo?.status ?? "unknown",
      isIdleWithOpenTransaction: blockerInfo?.status === "sleeping" && (blockerInfo?.open_transaction_count ?? 0) > 0,
      openTransactionCount: blockerInfo?.open_transaction_count ?? 0,
      lastStatementText: blockerInfo?.last_statement_text ?? null,
      lastRequestEndTime: blockerInfo?.last_request_end_time ?? null,
      databaseName: blockerInfo?.database_name ?? null,
      blockedSessions: chainWaiters.map((w) => ({
        sessionId: w.session_id,
        blockedBy: w.blocking_session_id,
        waitType: w.wait_type,
        waitTimeMs: w.wait_time_ms,
        waitResource: w.wait_resource,
        loginName: w.login_name,
        databaseName: w.database_name,
        queryText: w.query_text,
      })),
    };
  });
}
