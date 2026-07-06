import { getPool } from "../db";

export interface TempdbAllocator {
  sessionId: number;
  loginName: string | null;
  tempdbAllocatedMb: number;
}

export interface TempdbStats {
  totalDataFileMb: number;
  usedMb: number;
  freeMb: number;
  versionStoreMb: number;
  topAllocators: TempdbAllocator[];
}

export async function getTempdbStats(): Promise<TempdbStats> {
  const pool = getPool();

  const [spaceResult, versionStoreMb, allocatorsResult] = await Promise.all([
    pool.request().query(`
      SELECT
        CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(12, 2)) AS total_mb,
        CAST(SUM(FILEPROPERTY(name, 'SpaceUsed')) * 8.0 / 1024 AS DECIMAL(12, 2)) AS used_mb
      FROM tempdb.sys.database_files
      WHERE type = 0
    `),
    // sys.dm_tran_version_store_space_usage requires SQL Server 2016 SP2+/2017+; fall back to
    // 0 on older versions rather than failing the whole panel.
    pool
      .request()
      .query(`SELECT CAST(SUM(reserved_page_count) * 8.0 / 1024 AS DECIMAL(12, 2)) AS version_store_mb FROM sys.dm_tran_version_store_space_usage`)
      .then((r) => (r.recordset[0] as { version_store_mb: number | null }).version_store_mb ?? 0)
      .catch(() => 0),
    pool.request().query(`
      SELECT TOP 10
        u.session_id,
        s.login_name,
        CAST((u.user_objects_alloc_page_count + u.internal_objects_alloc_page_count
          - u.user_objects_dealloc_page_count - u.internal_objects_dealloc_page_count) * 8.0 / 1024 AS DECIMAL(12, 2)) AS tempdb_mb
      FROM sys.dm_db_session_space_usage u
      INNER JOIN sys.dm_exec_sessions s ON s.session_id = u.session_id
      WHERE (u.user_objects_alloc_page_count + u.internal_objects_alloc_page_count
          - u.user_objects_dealloc_page_count - u.internal_objects_dealloc_page_count) > 0
      ORDER BY tempdb_mb DESC
    `),
  ]);

  const space = spaceResult.recordset[0] as { total_mb: number; used_mb: number };

  return {
    totalDataFileMb: space.total_mb,
    usedMb: space.used_mb,
    freeMb: Math.round((space.total_mb - space.used_mb) * 100) / 100,
    versionStoreMb,
    topAllocators: allocatorsResult.recordset.map((row) => ({
      sessionId: row.session_id,
      loginName: row.login_name,
      tempdbAllocatedMb: row.tempdb_mb,
    })),
  };
}
