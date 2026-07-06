import { getPool } from "../db";

export interface AgentJobRow {
  jobName: string;
  startTime: string;
  sessionId: number | null;
  cpuTimeMs: number | null;
  logicalReads: number | null;
  writes: number | null;
  waitType: string | null;
}

// Currently-executing job steps, from msdb.dbo.sysjobactivity/syssessions, matched to the live
// SQL Agent session by its program_name, which embeds the job_id as hex
// (SQLAgent - TSQL JobStep (Job 0x<hex job_id> : Step N)). We compute that hex string in SQL
// itself (CAST ... AS varbinary(16), style 2) rather than in JS, since replicating SQL Server's
// GUID-to-hex byte ordering by hand is a well-known source of bugs.
export async function getRunningAgentJobs(): Promise<AgentJobRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      j.name AS job_name,
      CONVERT(varchar(33), ja.start_execution_date, 126) AS start_time,
      '0x' + CONVERT(varchar(34), CAST(j.job_id AS varbinary(16)), 2) AS job_id_hex
    FROM msdb.dbo.sysjobactivity ja
    INNER JOIN msdb.dbo.sysjobs j ON j.job_id = ja.job_id
    WHERE ja.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions)
      AND ja.start_execution_date IS NOT NULL
      AND ja.stop_execution_date IS NULL
  `);

  const jobs = result.recordset as { job_name: string; start_time: string; job_id_hex: string }[];
  if (jobs.length === 0) return [];

  const sessionsResult = await pool.request().query(`
    SELECT session_id, program_name, cpu_time, logical_reads, writes
    FROM sys.dm_exec_sessions
    WHERE program_name LIKE 'SQLAgent - TSQL JobStep%'
  `);
  const agentSessions = sessionsResult.recordset as {
    session_id: number;
    program_name: string;
    cpu_time: number;
    logical_reads: number;
    writes: number;
  }[];

  const waitsResult = await pool.request().query(`
    SELECT session_id, wait_type
    FROM sys.dm_exec_requests
  `);
  const waitBySession = new Map(
    (waitsResult.recordset as { session_id: number; wait_type: string | null }[]).map((r) => [r.session_id, r.wait_type])
  );

  return jobs.map((job) => {
    const matchingSession = agentSessions.find((s) => s.program_name.toUpperCase().includes(job.job_id_hex.toUpperCase()));
    return {
      jobName: job.job_name,
      startTime: job.start_time,
      sessionId: matchingSession?.session_id ?? null,
      cpuTimeMs: matchingSession?.cpu_time ?? null,
      logicalReads: matchingSession?.logical_reads ?? null,
      writes: matchingSession?.writes ?? null,
      waitType: matchingSession ? waitBySession.get(matchingSession.session_id) ?? null : null,
    };
  });
}
