import { getPool } from "../db";

export interface LogSpaceRow {
  databaseName: string;
  logSizeMb: number;
  logUsedPercent: number;
}

export interface VlfCountRow {
  databaseName: string;
  vlfCount: number;
}

// A full transaction log halts writes to that database entirely, which is a common and
// easily-missed cause of "everything just stopped." DBCC SQLPERF(LOGSPACE) reports every
// database's log space in one call, avoiding a per-database loop.
export async function getLogSpaceUsage(): Promise<LogSpaceRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    CREATE TABLE #logspace (
      database_name sysname,
      log_size_mb DECIMAL(15, 2),
      log_used_percent DECIMAL(5, 2),
      status BIT
    );
    INSERT INTO #logspace EXEC('DBCC SQLPERF(LOGSPACE)');

    SELECT database_name, log_size_mb, log_used_percent
    FROM #logspace
    WHERE log_used_percent > 50
    ORDER BY log_used_percent DESC;

    DROP TABLE #logspace;
  `);

  return result.recordset.map((row) => ({
    databaseName: row.database_name,
    logSizeMb: row.log_size_mb,
    logUsedPercent: row.log_used_percent,
  }));
}

// A log that's grown repeatedly in small increments ends up fragmented into hundreds or
// thousands of small internal chunks (VLFs) rather than a few large ones - unrelated to how
// full the log currently is, so this needs its own check separate from getLogSpaceUsage above.
// A high VLF count slows down recovery (restart, failover) and can slow log-heavy writes.
// sys.dm_db_log_info requires SQL Server 2017+; older versions fall back to an empty list
// rather than failing the whole panel (the DBCC LOGINFO equivalent needs a per-database loop
// that's much more failure-prone to get right across arbitrary server configurations).
export async function getVlfCounts(): Promise<VlfCountRow[]> {
  const pool = getPool();

  try {
    const result = await pool.request().query(`
      SELECT DB_NAME(d.database_id) AS database_name, COUNT(*) AS vlf_count
      FROM sys.databases d
      CROSS APPLY sys.dm_db_log_info(d.database_id) li
      WHERE d.state = 0
      GROUP BY d.database_id
      HAVING COUNT(*) > 100
      ORDER BY vlf_count DESC
    `);

    return result.recordset.map((row) => ({
      databaseName: row.database_name,
      vlfCount: row.vlf_count,
    }));
  } catch {
    return [];
  }
}
