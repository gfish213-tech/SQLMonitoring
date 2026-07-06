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
          hint="Includes user objects, internal objects (worktables, sort/hash spill space), and the version store."
        />
        <StatCard label="Free" value={`${tempdb.freeMb.toLocaleString()} MB`} />
        <StatCard
          label="Version Store"
          value={`${tempdb.versionStoreMb.toLocaleString()} MB`}
          hint="Space used by row versioning (snapshot isolation, triggers, MARS). Always reads 0 on SQL Server versions older than 2016 SP2/2017, even if version store usage exists there."
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
