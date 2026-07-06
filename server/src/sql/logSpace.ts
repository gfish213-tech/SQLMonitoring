import { getPool } from "../db";

export interface LogSpaceRow {
  databaseName: string;
  logSizeMb: number;
  logUsedPercent: number;
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
