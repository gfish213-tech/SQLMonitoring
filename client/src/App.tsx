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
import { VolumeSpacePanel } from "./components/VolumeSpacePanel";
import { LogSpacePanel } from "./components/LogSpacePanel";
import { IoLatencyPanel } from "./components/IoLatencyPanel";
import { AutogrowthPanel } from "./components/AutogrowthPanel";
import { DeadlocksPanel } from "./components/DeadlocksPanel";
import { IndexStatsPanel } from "./components/IndexStatsPanel";
import { useTriage } from "./hooks/useTriage";
import { buildSummaryText } from "./summary";
import type { ConnectionMeta, DashboardTab, TriageData } from "./types";

function environmentClass(env?: string): string {
  const e = (env ?? "").toLowerCase();
  if (e.includes("prod")) return "env-prod";
  if (e.includes("staging")) return "env-staging";
  if (e.includes("dev")) return "env-dev";
  if (e.includes("no longer")) return "env-deprecated";
  return "";
}

// One entry per tab. `hasData` drives the small dot shown on the tab button, so a DBA can see
// at a glance which tabs actually have something to look at without clicking through all of them
// - the same "don't make me scan empty panels" goal the old sorted 2-column layout served.
function buildTabs(data: TriageData): { key: DashboardTab; label: string; hasData: boolean; node: ReactNode }[] {
  return [
    {
      key: "overview",
      label: "Overview",
      hasData: false,
      node: (
        <>
          <OverviewBar overview={data.overview} />
          <div className="dashboard-row">
            <PressurePanel pressure={data.pressure} />
            <TempdbPanel tempdb={data.tempdb} />
          </div>
          <VolumeSpacePanel volumeSpace={data.volumeSpace} />
        </>
      ),
    },
    { key: "blocking", label: "Blocking", hasData: data.blocking.length > 0, node: <BlockingPanel blocking={data.blocking} /> },
    { key: "consumers", label: "Consumers", hasData: data.consumers.length > 0, node: <ConsumersPanel consumers={data.consumers} /> },
    { key: "longops", label: "Backups", hasData: data.longOps.length > 0, node: <LongOpsPanel longOps={data.longOps} /> },
    { key: "agentjobs", label: "Agent Jobs", hasData: data.agentJobs.length > 0, node: <AgentJobsPanel agentJobs={data.agentJobs} /> },
    { key: "waits", label: "Waits", hasData: data.waits.length > 0, node: <WaitsPanel waits={data.waits} /> },
    {
      key: "logspace",
      label: "Log Space",
      hasData: data.logSpace.length > 0 || data.vlfCounts.length > 0,
      node: <LogSpacePanel logSpace={data.logSpace} vlfCounts={data.vlfCounts} />,
    },
    { key: "iolatency", label: "IO Latency", hasData: data.ioLatency.length > 0, node: <IoLatencyPanel ioLatency={data.ioLatency} /> },
    { key: "autogrowth", label: "Autogrowth", hasData: data.autogrowth.length > 0, node: <AutogrowthPanel autogrowth={data.autogrowth} /> },
    { key: "deadlocks", label: "Deadlocks", hasData: data.deadlocks.length > 0, node: <DeadlocksPanel deadlocks={data.deadlocks} /> },
    {
      key: "indexes",
      label: "Indexes",
      hasData: data.indexStats.topScannedTables.length > 0 || data.indexStats.unusedIndexes.length > 0,
      node: <IndexStatsPanel indexStats={data.indexStats} />,
    },
  ];
}

function Dashboard({ connection, onDisconnect }: { connection: ConnectionMeta; onDisconnect: () => void }) {
  const { data, error, loading, lastUpdated, refresh, autoRefresh, setAutoRefresh } = useTriage();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  async function handleCopy() {
    if (!data) return;
    await navigator.clipboard.writeText(buildSummaryText(data, connection));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabs = data ? buildTabs(data) : [];
  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];

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
          <nav className="tab-bar" aria-label="Dashboard sections">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={t.key === activeTab ? "active" : ""}
                onClick={() => setActiveTab(t.key)}
                aria-current={t.key === activeTab}
              >
                {t.label}
                {t.hasData && <span className="tab-dot" />}
              </button>
            ))}
          </nav>
        )}
      </div>

      {error && <div className="message error">{error}</div>}

      {data && (
        <main className="dashboard">
          <DiagnosisSummary data={data} onJumpToPanel={setActiveTab} />
          {active?.node}
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
