import { getPool } from "../db";

export interface ErrorLogEntry {
  timestamp: string;
  severity: number | null;
  message: string;
}

interface RawErrorLogRow {
  log_date: string;
  text: string;
}

const SEVERITY_PATTERN = /Severity:\s*(\d+)/i;

// xp_readerrorlog only AND's its two optional search-string filters together, which can't
// express "any of these several patterns" (corruption codes, out-of-memory, etc.) - simpler and
// more complete to pull the whole 24h window unfiltered and filter here. Severity alone (not a
// separate list of error-number patterns) catches what's worth surfacing: 823/824/825
// (corruption) are Severity 24/25, out-of-memory (701/17803) is Severity 17/20 - every "real
// failure, not routine noise" line in the log carries a Severity >= 16.
function parseSeverity(text: string): number | null {
  const match = SEVERITY_PATTERN.exec(text);
  return match ? Number(match[1]) : null;
}

// Reads the last 24 hours of SQL Server's own error log (current log file only - a log that
// recycled very recently, e.g. right after a restart, could have older entries in Errorlog.1
// this doesn't follow; a documented trade-off, not an oversight, matching how indexStats.ts
// documents its own index-name-resolution trade-off). Wrapped in try/catch: xp_readerrorlog can
// be restricted by policy, same as the trace/XE reads in autogrowth.ts/deadlocks.ts.
export async function getRecentErrorLogEntries(): Promise<ErrorLogEntry[]> {
  const pool = getPool();

  try {
    const result = await pool.request().query(`
      CREATE TABLE #errorlog (LogDate DATETIME, ProcessInfo NVARCHAR(50), Text NVARCHAR(MAX));
      INSERT INTO #errorlog (LogDate, ProcessInfo, Text)
      EXEC xp_readerrorlog 0, 1, NULL, NULL, DATEADD(HOUR, -24, GETDATE()), NULL;
      SELECT TOP 200 CONVERT(varchar(33), LogDate, 126) AS log_date, Text AS text
      FROM #errorlog
      ORDER BY LogDate DESC;
      DROP TABLE #errorlog;
    `);

    return (result.recordset as RawErrorLogRow[])
      .map((row) => ({ timestamp: row.log_date, severity: parseSeverity(row.text), message: row.text.trim() }))
      .filter((row) => row.severity !== null && row.severity >= 16)
      .slice(0, 50);
  } catch {
    return [];
  }
}
