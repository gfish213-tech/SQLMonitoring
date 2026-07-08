import { getPool } from "../db";

export interface TopScannedTable {
  databaseName: string;
  tableName: string;
  totalScans: number;
  totalSeeks: number;
  totalLookups: number;
}

export interface UnusedIndex {
  databaseName: string;
  tableName: string;
  indexId: number;
  totalWrites: number;
}

export interface IndexStats {
  topScannedTables: TopScannedTable[];
  unusedIndexes: UnusedIndex[];
}

// sys.dm_db_index_usage_stats is server-wide (covers every database from any connection, no
// per-database looping needed) but resets on restart or index rebuild, same "since restart"
// caveat as sys.dm_io_virtual_file_stats elsewhere in this app. Index *names* live in
// sys.indexes, which is a per-current-database catalog view - resolving them across every
// other database on the server would need dynamic SQL executed once per database (the
// standard DBA-script pattern for this), which this app deliberately avoids for reliability
// across arbitrary server configurations. index_id is shown instead of a resolved name; still
// enough to find the culprit table and open it in SSMS.
//
// OBJECT_NAME(id, dbid) against a database other than the current one is a genuinely slow,
// per-row cross-database metadata lookup - calling it in a WHERE clause forces SQL Server to
// pay that cost for every row in the DMV (which on a server with many databases/objects can be
// tens of thousands of rows) before any cheap numeric filtering happens. Both queries below
// filter on plain numeric columns first (inside the derived table / GROUP BY+HAVING), then
// resolve the name exactly once per surviving row via CROSS APPLY - the same lookup, just
// deferred until after the row count has already been cut down.
export async function getIndexStats(): Promise<IndexStats> {
  const pool = getPool();

  try {
    const [scanned, unused] = await Promise.all([
      pool.request().query(`
        SELECT TOP 15 database_name, table_name, total_scans, total_seeks, total_lookups
        FROM (
          SELECT
            ius.database_id,
            ius.object_id,
            SUM(ius.user_scans) AS total_scans,
            SUM(ius.user_seeks) AS total_seeks,
            SUM(ius.user_lookups) AS total_lookups
          FROM sys.dm_db_index_usage_stats ius
          WHERE ius.database_id > 4
          GROUP BY ius.database_id, ius.object_id
          HAVING SUM(ius.user_scans) > 0
        ) agg
        CROSS APPLY (SELECT DB_NAME(agg.database_id) AS database_name, OBJECT_NAME(agg.object_id, agg.database_id) AS table_name) names
        WHERE names.table_name IS NOT NULL
        ORDER BY total_scans DESC
      `),
      pool.request().query(`
        SELECT TOP 15 database_name, table_name, index_id, total_writes
        FROM (
          SELECT ius.database_id, ius.object_id, ius.index_id, ius.user_updates AS total_writes
          FROM sys.dm_db_index_usage_stats ius
          WHERE ius.database_id > 4
            AND ius.index_id > 0
            AND ius.user_updates > 0
            AND (ius.user_seeks + ius.user_scans + ius.user_lookups) = 0
        ) filtered
        CROSS APPLY (SELECT DB_NAME(filtered.database_id) AS database_name, OBJECT_NAME(filtered.object_id, filtered.database_id) AS table_name) names
        WHERE names.table_name IS NOT NULL
        ORDER BY total_writes DESC
      `),
    ]);

    return {
      topScannedTables: scanned.recordset.map((row) => ({
        databaseName: row.database_name,
        tableName: row.table_name,
        totalScans: row.total_scans,
        totalSeeks: row.total_seeks,
        totalLookups: row.total_lookups,
      })),
      unusedIndexes: unused.recordset.map((row) => ({
        databaseName: row.database_name,
        tableName: row.table_name,
        indexId: row.index_id,
        totalWrites: row.total_writes,
      })),
    };
  } catch {
    // On a server with a very large number of databases/objects this can still be slow enough
    // to time out - treat that the same as the trace-/XE-based checks elsewhere in this file's
    // siblings (autogrowth.ts, deadlocks.ts): fail soft to "nothing to show" rather than take
    // down the rest of a Full Refresh over one panel.
    return { topScannedTables: [], unusedIndexes: [] };
  }
}
