import { getPool } from "../db";

export interface AutogrowthEvent {
  databaseName: string | null;
  fileName: string | null;
  eventType: string;
  startTime: string;
  durationMs: number;
}

// Data/log file autogrowth events pause writes to that file while the OS extends it — a classic,
// easy-to-miss cause of sudden multi-second freezes. Pulled from the default trace (event IDs 92
// = Data File Auto Grow, 93 = Log File Auto Grow), which every SQL Server instance runs unless
// explicitly disabled.
export async function getRecentAutogrowthEvents(): Promise<AutogrowthEvent[]> {
  const pool = getPool();

  try {
    const result = await pool.request().query(`
      DECLARE @tracePath NVARCHAR(260) = (SELECT TOP 1 path FROM sys.traces WHERE is_default = 1);

      SELECT TOP 20
        DatabaseName AS database_name,
        FileName AS file_name,
        CASE EventClass WHEN 92 THEN 'Data' WHEN 93 THEN 'Log' ELSE 'Unknown' END AS event_type,
        CONVERT(varchar(33), StartTime, 126) AS start_time,
        Duration / 1000 AS duration_ms
      FROM ::fn_trace_gettable(@tracePath, DEFAULT)
      WHERE EventClass IN (92, 93)
        AND StartTime > DATEADD(HOUR, -24, GETDATE())
      ORDER BY StartTime DESC
    `);

    return result.recordset.map((row) => ({
      databaseName: row.database_name,
      fileName: row.file_name,
      eventType: row.event_type,
      startTime: row.start_time,
      durationMs: row.duration_ms,
    }));
  } catch {
    // The default trace can be disabled by policy; treat that as "no data" rather than an error.
    return [];
  }
}
