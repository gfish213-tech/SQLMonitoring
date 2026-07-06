import { useEffect, useState } from "react";
import { api } from "./api";
import { ServerPicker } from "./components/ServerPicker";
import { OverviewBar } from "./components/OverviewBar";
import { BlockingPanel } from "./components/BlockingPanel";
import { LongOpsPanel } from "./components/LongOpsPanel";
import { AgentJobsPanel } from "./components/AgentJobsPanel";
import { ConsumersPanel } from "./components/ConsumersPanel";
import { WaitsPanel } from "./components/WaitsPanel";
import { PressurePanel } from "./components/PressurePanel";
import { TempdbPanel } from "./components/TempdbPanel";
import { LogSpacePanel } from "./components/LogSpacePanel";
import { IoLatencyPanel } from "./components/IoLatencyPanel";
import { AutogrowthPanel } from "./components/AutogrowthPanel";
import { DeadlocksPanel } from "./components/DeadlocksPanel";
import { useTriage } from "./hooks/useTriage";
import type { ConnectionMeta } from "./types";

function environmentClass(env?: string): string {
  const e = (env ?? "").toLowerCase();
  if (e.includes("prod")) return "env-prod";
  if (e.includes("staging")) return "env-staging";
  if (e.includes("dev")) return "env-dev";
  if (e.includes("no longer")) return "env-deprecated";
  return "";
}

function Dashboard({ connection, onDisconnect }: { connection: ConnectionMeta; onDisconnect: () => void }) {
  const { data, error, loading, lastUpdated, refresh, autoRefresh, setAutoRefresh } = useTriage();

  return (
    <div className="page">
      <header className="app-header">
        <h1>SQL Performance Monitor</h1>
        <div className="connection-info">
          <span>
            {connection.label ?? connection.server}
            {connection.environment && <span className={`env-badge ${environmentClass(connection.environment)}`}>{connection.environment}</span>}
          </span>
          <span className="connection-detail">
            {connection.loginName} · {connection.database} · {connection.odbcDriver}
          </span>
          <button onClick={onDisconnect}>Switch Server</button>
        </div>
      </header>

      <div className="refresh-bar">
        <button className="primary" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <label className="auto-refresh-toggle">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh every 20s
        </label>
        {lastUpdated && <span className="last-updated">Last updated {lastUpdated.toLocaleTimeString()}</span>}
      </div>

      {error && <div className="message error">{error}</div>}

      {data && (
        <main className="dashboard">
          <OverviewBar overview={data.overview} />
          <BlockingPanel blocking={data.blocking} />
          <div className="dashboard-row">
            <LongOpsPanel longOps={data.longOps} />
            <AgentJobsPanel agentJobs={data.agentJobs} />
          </div>
          <ConsumersPanel consumers={data.consumers} />
          <WaitsPanel waits={data.waits} />
          <div className="dashboard-row">
            <PressurePanel pressure={data.pressure} />
            <TempdbPanel tempdb={data.tempdb} />
          </div>
          <LogSpacePanel logSpace={data.logSpace} />
          <IoLatencyPanel ioLatency={data.ioLatency} />
          <AutogrowthPanel autogrowth={data.autogrowth} />
          <DeadlocksPanel deadlocks={data.deadlocks} />
        </main>
      )}
    </div>
  );
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionMeta | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  useEffect(() => {
    api
      .status()
      .then((s) => setConnection(s.connected ? s.connection : null))
      .catch(() => setConnection(null))
      .finally(() => setCheckingStatus(false));
  }, []);

  async function handleDisconnect() {
    await api.disconnect();
    setConnection(null);
  }

  if (checkingStatus) {
    return <div className="loading full-page">Loading...</div>;
  }

  if (!connection) {
    return (
      <div className="page centered">
        <ServerPicker onConnected={setConnection} />
      </div>
    );
  }

  return <Dashboard connection={connection} onDisconnect={handleDisconnect} />;
}
