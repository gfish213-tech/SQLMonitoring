import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { ServerPicker } from "./components/ServerPicker";
import { DiagnosisSummary } from "./components/DiagnosisSummary";
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
import { buildSummaryText } from "./summary";
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
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!data) return;
    await navigator.clipboard.writeText(buildSummaryText(data, connection));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Reference panels flow into a 2-column layout sorted so anything with data floats above the
  // quiet "nothing to report" ones - the whole point is not making a DBA scroll past 7 empty
  // cards to find the one that matters. Blocking/Consumers stay full-width above this since
  // their tables are the widest and usually the most information-dense when something's wrong.
  const reference: { empty: boolean; node: ReactNode }[] = data
    ? [
        { empty: data.longOps.length === 0, node: <LongOpsPanel key="longOps" longOps={data.longOps} /> },
        { empty: data.agentJobs.length === 0, node: <AgentJobsPanel key="agentJobs" agentJobs={data.agentJobs} /> },
        { empty: data.waits.length === 0, node: <WaitsPanel key="waits" waits={data.waits} /> },
        { empty: data.logSpace.length === 0, node: <LogSpacePanel key="logSpace" logSpace={data.logSpace} /> },
        { empty: data.ioLatency.length === 0, node: <IoLatencyPanel key="ioLatency" ioLatency={data.ioLatency} /> },
        { empty: data.autogrowth.length === 0, node: <AutogrowthPanel key="autogrowth" autogrowth={data.autogrowth} /> },
        { empty: data.deadlocks.length === 0, node: <DeadlocksPanel key="deadlocks" deadlocks={data.deadlocks} /> },
      ].sort((a, b) => Number(a.empty) - Number(b.empty))
    : [];

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

      <div className="sticky-toolbar">
        <div className="refresh-bar">
          <button className="primary" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <label className="auto-refresh-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh every 20s
          </label>
          <button onClick={handleCopy} disabled={!data}>
            {copied ? "Copied!" : "Copy for AI"}
          </button>
          {lastUpdated && <span className="last-updated">Last updated {lastUpdated.toLocaleTimeString()}</span>}
        </div>

        {data && (
          <nav className="section-nav" aria-label="Jump to section">
            <a href="#panel-diagnosis">Diagnosis</a>
            <a href="#panel-overview">Overview</a>
            <a href="#panel-pressure">Pressure</a>
            <a href="#panel-tempdb">TempDB</a>
            <a href="#panel-blocking">Blocking</a>
            <a href="#panel-consumers">Consumers</a>
            <a href="#panel-longops">Backups</a>
            <a href="#panel-agentjobs">Agent Jobs</a>
            <a href="#panel-waits">Waits</a>
            <a href="#panel-logspace">Log Space</a>
            <a href="#panel-iolatency">IO Latency</a>
            <a href="#panel-autogrowth">Autogrowth</a>
            <a href="#panel-deadlocks">Deadlocks</a>
          </nav>
        )}
      </div>

      {error && <div className="message error">{error}</div>}

      {data && (
        <main className="dashboard">
          <DiagnosisSummary data={data} />
          <OverviewBar overview={data.overview} />
          <div className="dashboard-row">
            <PressurePanel pressure={data.pressure} />
            <TempdbPanel tempdb={data.tempdb} />
          </div>
          <BlockingPanel blocking={data.blocking} />
          <ConsumersPanel consumers={data.consumers} />
          <div className="reference-grid">{reference.map((r) => r.node)}</div>
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
