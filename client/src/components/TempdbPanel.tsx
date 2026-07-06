import { StatCard } from "./StatCard";
import type { TempdbStats } from "../types";

export function TempdbPanel({ tempdb }: { tempdb: TempdbStats }) {
  const usedPercent = tempdb.totalDataFileMb > 0 ? Math.round((tempdb.usedMb / tempdb.totalDataFileMb) * 100) : 0;

  return (
    <section id="panel-tempdb" className="panel">
      <div className="panel-header">
        <h2>TempDB Contention</h2>
      </div>
      <div className="stat-grid">
        <StatCard label="TempDB Size" value={`${tempdb.totalDataFileMb.toLocaleString()} MB`} />
        <StatCard
          label="Used"
          value={`${usedPercent}%`}
          tone={usedPercent > 80 ? "danger" : usedPercent > 60 ? "warning" : undefined}
          hint="User objects + internal objects + version store, broken down below."
        />
        <StatCard label="Free" value={`${tempdb.freeMb.toLocaleString()} MB`} />
      </div>
      <div className="stat-grid" style={{ marginTop: 14 }}>
        <StatCard
          label="User Objects"
          value={`${tempdb.userObjectsMb.toLocaleString()} MB`}
          hint="Actual #temp tables and table variables created by user queries."
        />
        <StatCard
          label="Internal Objects"
          value={`${tempdb.internalObjectsMb.toLocaleString()} MB`}
          hint="Sort runs, hash joins, and spooling tables created by the query optimizer to execute a query plan."
        />
        <StatCard
          label="Version Store"
          value={`${tempdb.versionStoreMb.toLocaleString()} MB`}
          hint="Row versions used by read committed snapshot isolation (RCSI), snapshot isolation, triggers, or MARS."
        />
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
