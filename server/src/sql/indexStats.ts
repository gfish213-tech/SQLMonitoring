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
export async function getIndexStats(): Promise<IndexStats> {
  const pool = getPool();

  const [scanned, unused] = await Promise.all([
    pool.request().query(`
      SELECT TOP 15
        DB_NAME(ius.database_id) AS database_name,
        OBJECT_NAME(ius.object_id, ius.database_id) AS table_name,
        SUM(ius.user_scans) AS total_scans,
        SUM(ius.user_seeks) AS total_seeks,
        SUM(ius.user_lookups) AS total_lookups
      FROM sys.dm_db_index_usage_stats ius
      WHERE ius.database_id > 4
        AND OBJECT_NAME(ius.object_id, ius.database_id) IS NOT NULL
      GROUP BY ius.database_id, ius.object_id
      HAVING SUM(ius.user_scans) > 0
      ORDER BY total_scans DESC
    `),
    pool.request().query(`
      SELECT TOP 15
        DB_NAME(ius.database_id) AS database_name,
        OBJECT_NAME(ius.object_id, ius.database_id) AS table_name,
        ius.index_id,
        ius.user_updates AS total_writes
      FROM sys.dm_db_index_usage_stats ius
      WHERE ius.database_id > 4
        AND ius.index_id > 0
        AND ius.user_updates > 0
        AND (ius.user_seeks + ius.user_scans + ius.user_lookups) = 0
        AND OBJECT_NAME(ius.object_id, ius.database_id) IS NOT NULL
      ORDER BY ius.user_updates DESC
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
}
