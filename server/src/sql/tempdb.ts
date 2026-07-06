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
  userObjectsMb: number;
  internalObjectsMb: number;
  versionStoreMb: number;
  topAllocators: TempdbAllocator[];
}

export async function getTempdbStats(): Promise<TempdbStats> {
  const pool = getPool();

  const [spaceResult, breakdown, allocatorsResult] = await Promise.all([
    pool.request().query(`
      SELECT CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(12, 2)) AS total_mb
      FROM tempdb.sys.database_files
      WHERE type = 0
    `),
    // sys.dm_db_file_space_usage is tempdb-specific and queryable via a 3-part name from any
    // database context (unlike FILEPROPERTY, which evaluates against whatever database this
    // connection is currently in - this app defaults to "master", so FILEPROPERTY against
    // tempdb's file names previously returned NULL for every row). Its breakdown columns
    // require SQL Server 2012+; fall back to all-zero on anything older rather than failing
    // the whole panel.
    pool
      .request()
      .query(
        `
        SELECT
          CAST(SUM(user_object_reserved_page_count) * 8.0 / 1024 AS DECIMAL(12, 2)) AS user_objects_mb,
          CAST(SUM(internal_object_reserved_page_count) * 8.0 / 1024 AS DECIMAL(12, 2)) AS internal_objects_mb,
          CAST(SUM(version_store_reserved_page_count) * 8.0 / 1024 AS DECIMAL(12, 2)) AS version_store_mb
        FROM tempdb.sys.dm_db_file_space_usage
      `
      )
      .then((r) => r.recordset[0] as { user_objects_mb: number; internal_objects_mb: number; version_store_mb: number })
      .catch(() => ({ user_objects_mb: 0, internal_objects_mb: 0, version_store_mb: 0 })),
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

  const space = spaceResult.recordset[0] as { total_mb: number };
  const usedMb = Math.round((breakdown.user_objects_mb + breakdown.internal_objects_mb + breakdown.version_store_mb) * 100) / 100;

  return {
    totalDataFileMb: space.total_mb,
    usedMb,
    freeMb: Math.round((space.total_mb - usedMb) * 100) / 100,
    userObjectsMb: breakdown.user_objects_mb,
    internalObjectsMb: breakdown.internal_objects_mb,
    versionStoreMb: breakdown.version_store_mb,
    topAllocators: allocatorsResult.recordset.map((row) => ({
      sessionId: row.session_id,
      loginName: row.login_name,
      tempdbAllocatedMb: row.tempdb_mb,
    })),
  };
}
