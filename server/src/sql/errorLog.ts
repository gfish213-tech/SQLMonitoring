import { getPool, extractDriverError } from "../db";

export interface ErrorLogEntry {
  timestamp: string;
  severity: number | null;
  message: string;
}

export interface ErrorLogResult {
  entries: ErrorLogEntry[];
  error: string | null;
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
// documents its own index-name-resolution trade-off). Returns the real error text on failure
// (xp_readerrorlog can be restricted by policy, or the calling account may lack the securityadmin/
// serveradmin-ish rights it needs) rather than silently reading as "no entries" - the same
// "[object Object]" driver quirk queryStoreRegressions.ts had to work around applies here too.
export async function getRecentErrorLogEntries(): Promise<ErrorLogResult> {
  const pool = getPool();

  try {
    // EXEC's positional-parameter syntax only accepts constants or variables, not arbitrary
    // expressions - DATEADD(HOUR, -24, GETDATE()) passed directly as a parameter is a syntax
    // error ("Incorrect syntax near 'HOUR'"), not a runtime one. Computing it into @startTime
    // first is required, not just style.
    const result = await pool.request().query(`
      DECLARE @startTime DATETIME = DATEADD(HOUR, -24, GETDATE());
      CREATE TABLE #errorlog (LogDate DATETIME, ProcessInfo NVARCHAR(50), Text NVARCHAR(MAX));
      INSERT INTO #errorlog (LogDate, ProcessInfo, Text)
      EXEC xp_readerrorlog 0, 1, NULL, NULL, @startTime, NULL;
      SELECT TOP 200 CONVERT(varchar(33), LogDate, 126) AS log_date, Text AS text
      FROM #errorlog
      ORDER BY LogDate DESC;
      DROP TABLE #errorlog;
    `);

    const entries = (result.recordset as RawErrorLogRow[])
      .map((row) => ({ timestamp: row.log_date, severity: parseSeverity(row.text), message: row.text.trim() }))
      .filter((row) => row.severity !== null && row.severity >= 16)
      .slice(0, 50);
    return { entries, error: null };
  } catch (err) {
    return { entries: [], error: extractDriverError(err).message };
  }
}
