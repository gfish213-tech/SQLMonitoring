import { getPool } from "../db";

export interface DeadlockEvent {
  timestamp: string;
  xml: string;
}

// The system_health extended events session captures deadlock graphs by default on every
// instance (unless explicitly disabled) — no setup required, unlike trace flags. We surface the
// raw deadlock XML rather than parsing out victim/winner details: XDL deadlock graphs vary
// enough in shape across SQL Server versions that hand-parsing is a common source of subtly
// wrong output, and the raw graph is directly readable by a DBA (or pastable into a XDL viewer).
export async function getRecentDeadlocks(): Promise<DeadlockEvent[]> {
  const pool = getPool();

  try {
    const result = await pool.request().query(`
      SELECT TOP 10
        CONVERT(varchar(33), event_data.value('(@timestamp)[1]', 'datetime2'), 126) AS event_time,
        event_data.query('(data[@name="xml_report"]/value/deadlock)[1]') AS deadlock_xml
      FROM (
        SELECT CAST(target_data AS XML) AS target_data
        FROM sys.dm_xe_session_targets st
        INNER JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
        WHERE s.name = 'system_health' AND st.target_name = 'ring_buffer'
      ) AS t
      CROSS APPLY target_data.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS e(event_data)
      ORDER BY event_time DESC
    `);

    return result.recordset
      .map((row) => ({ timestamp: row.event_time, xml: String(row.deadlock_xml ?? "") }))
      .filter((row) => row.xml.length > 0);
  } catch {
    // system_health can be stopped/reconfigured by policy; treat that as "no data".
    return [];
  }
}
