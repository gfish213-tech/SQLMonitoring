import { getPool } from "../db";

export interface VolumeSpaceRow {
  volumeMountPoint: string;
  logicalVolumeName: string | null;
  totalGb: number;
  freeGb: number;
  freePercent: number;
}

// Every distinct OS volume hosting a SQL Server data/log/tempdb file, with current free space -
// answers "is a drive about to run out of room" without having to remote-desktop in and check
// Windows Explorer. This is current state, not historical, so (per the rest of this app's
// panels) it's shown in full rather than thresholded down to "abnormal only" - a DBA benefits
// from seeing every volume's headroom, not just the ones already in trouble.
export async function getVolumeSpace(): Promise<VolumeSpaceRow[]> {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT
      vs.volume_mount_point,
      vs.logical_volume_name,
      CAST(vs.total_bytes / 1024.0 / 1024 / 1024 AS DECIMAL(10, 2)) AS total_gb,
      CAST(vs.available_bytes / 1024.0 / 1024 / 1024 AS DECIMAL(10, 2)) AS free_gb,
      CAST(vs.available_bytes * 100.0 / NULLIF(vs.total_bytes, 0) AS DECIMAL(5, 2)) AS free_percent
    FROM sys.master_files mf
    CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
    ORDER BY free_percent ASC
  `);

  return result.recordset.map((row) => ({
    volumeMountPoint: row.volume_mount_point,
    logicalVolumeName: row.logical_volume_name,
    totalGb: row.total_gb,
    freeGb: row.free_gb,
    freePercent: row.free_percent,
  }));
}
