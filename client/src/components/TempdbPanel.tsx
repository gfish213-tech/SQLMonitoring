import { StatCard } from "./StatCard";
import type { TempdbStats } from "../types";

export function TempdbPanel({ tempdb }: { tempdb: TempdbStats }) {
  const usedPercent = tempdb.totalDataFileMb > 0 ? Math.round((tempdb.usedMb / tempdb.totalDataFileMb) * 100) : 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>TempDB Contention</h2>
      </div>
      <div className="stat-grid">
        <StatCard label="TempDB Size" value={`${tempdb.totalDataFileMb.toLocaleString()} MB`} />
        <StatCard label="Used" value={`${usedPercent}%`} tone={usedPercent > 80 ? "danger" : usedPercent > 60 ? "warning" : undefined} />
        <StatCard label="Free" value={`${tempdb.freeMb.toLocaleString()} MB`} />
        <StatCard label="Version Store" value={`${tempdb.versionStoreMb.toLocaleString()} MB`} />
      </div>
      {tempdb.topAllocators.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Login</th>
                <th>TempDB Used</th>
              </tr>
            </thead>
            <tbody>
              {tempdb.topAllocators.map((a) => (
                <tr key={a.sessionId}>
                  <td>{a.sessionId}</td>
                  <td>{a.loginName ?? "-"}</td>
                  <td>{a.tempdbAllocatedMb.toLocaleString()} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
