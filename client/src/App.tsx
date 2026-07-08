import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { ServerPicker } from "./components/ServerPicker";
import { ThemeToggle } from "./components/ThemeToggle";
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
import { NotCheckedPanel } from "./components/NotCheckedPanel";
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

// One entry per tab. `hasData` drives the dot shown on the tab button: true (red, flagged) if
// the check ran and found something, false (no dot) if it ran and found nothing, undefined
// (dim dot) if this data hasn't been fetched yet — a full-only check before a Full Refresh has
// run. Treating "not checked" as a third state (not just falling back to "clean") matters here:
// a dashboard that quietly reads as "all clear" when half its checks never ran would be worse
// than the long-scrolling single page this replaced.
function buildTabs(data: TriageData): { key: DashboardTab; label: string; hasData: boolean | undefined; node: ReactNode }[] {
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
            {data.tempdb ? <TempdbPanel tempdb={data.tempdb} /> : <NotCheckedPanel label="TempDB Contention" />}
          </div>
          {data.volumeSpace ? <VolumeSpacePanel volumeSpace={data.volumeSpace} /> : <NotCheckedPanel label="Disk Volume Space" />}
        </>
      ),
    },
    { key: "blocking", label: "Blocking", hasData: data.blocking.length > 0, node: <BlockingPanel blocking={data.blocking} /> },
    {
      key: "consumers",
      label: "Consumers",
      hasData: data.consumers ? data.consumers.length > 0 : undefined,
      node: data.consumers ? <ConsumersPanel consumers={data.consumers} /> : <NotCheckedPanel label="Top Resource Consumers (Right Now)" />,
    },
    { key: "longops", label: "Backups", hasData: data.longOps.length > 0, node: <LongOpsPanel longOps={data.longOps} /> },
    { key: "agentjobs", label: "Agent Jobs", hasData: data.agentJobs.length > 0, node: <AgentJobsPanel agentJobs={data.agentJobs} /> },
    { key: "waits", label: "Waits", hasData: data.waits.length > 0, node: <WaitsPanel waits={data.waits} /> },
    {
      key: "logspace",
      label: "Log Space",
      hasData: data.logSpace.length > 0 || (data.vlfCounts?.length ?? 0) > 0,
      node: <LogSpacePanel logSpace={data.logSpace} vlfCounts={data.vlfCounts} />,
    },
    {
      key: "iolatency",
      label: "IO Latency",
      hasData: data.ioLatency ? data.ioLatency.length > 0 : undefined,
      node: data.ioLatency ? <IoLatencyPanel ioLatency={data.ioLatency} /> : <NotCheckedPanel label="Disk / IO Latency" />,
    },
    {
      key: "autogrowth",
      label: "Autogrowth",
      hasData: data.autogrowth ? data.autogrowth.length > 0 : undefined,
      node: data.autogrowth ? <AutogrowthPanel autogrowth={data.autogrowth} /> : <NotCheckedPanel label="Recent Auto-Growth Events" />,
    },
    {
      key: "deadlocks",
      label: "Deadlocks",
      hasData: data.deadlocks ? data.deadlocks.length > 0 : undefined,
      node: data.deadlocks ? <DeadlocksPanel deadlocks={data.deadlocks} /> : <NotCheckedPanel label="Recent Deadlocks" />,
    },
    {
      key: "indexes",
      label: "Indexes",
      hasData: data.indexStats ? data.indexStats.topScannedTables.length > 0 || data.indexStats.unusedIndexes.length > 0 : undefined,
      node: data.indexStats ? <IndexStatsPanel indexStats={data.indexStats} /> : <NotCheckedPanel label="Index Stats" />,
    },
  ];
}

function Dashboard({ connection, onDisconnect }: { connection: ConnectionMeta; onDisconnect: () => void }) {
  const {
    data,
    error,
    loading,
    lastUpdated,
    lastMode,
    refresh,
    fullRefresh,
    autoRefresh,
    setAutoRefresh,
    refreshPanel,
    panelLoading,
    panelUpdatedAt,
  } = useTriage();
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
          <button className="primary" onClick={refresh} disabled={loading} title="Small, single-pass queries only — safe to run often, even on a struggling server.">
            {loading ? "Refreshing..." : "Quick Refresh"}
          </button>
          <button onClick={fullRefresh} disabled={loading} title="Adds heavier checks: Consumers, TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, Indexes.">
            Full Refresh
          </button>
          <label className="auto-refresh-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh every 20s (quick only)
          </label>
          <button onClick={handleCopy} disabled={!data}>
            {copied ? "Copied!" : "Copy for AI"}
          </button>
          {lastUpdated && (
            <span className="last-updated">
              Last updated {lastUpdated.toLocaleTimeString()}
              {lastMode === "quick" && " (quick check)"}
            </span>
          )}
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
                {t.hasData === true && <span className="tab-dot" />}
                {t.hasData === undefined && <span className="tab-dot-unknown" title="Not checked yet — run Full Refresh" />}
              </button>
            ))}
          </nav>
        )}
      </div>

      {error && <div className="message error">{error}</div>}

      {data && (
        <main className="dashboard">
          <DiagnosisSummary data={data} onJumpToPanel={setActiveTab} isQuickOnly={lastMode === "quick"} />
          <div className="panel-refresh-row">
            <span className="panel-refresh-label">
              {active?.label}
              {panelUpdatedAt[activeTab] && ` · panel refreshed ${panelUpdatedAt[activeTab]!.toLocaleTimeString()}`}
            </span>
            <button
              onClick={() => refreshPanel(activeTab)}
              disabled={panelLoading === activeTab}
              title={`Re-run just this tab's query — lighter than Quick or Full Refresh, doesn't touch any other tab's data.`}
            >
              {panelLoading === activeTab ? "Refreshing..." : `↻ Refresh ${active?.label}`}
            </button>
          </div>
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
    return (
      <>
        <ThemeToggle />
        <div className="loading full-page">Loading...</div>
      </>
    );
  }

  if (!connection) {
    return (
      <>
        <ThemeToggle />
        <div className="page centered">
          <ServerPicker onConnected={setConnection} />
        </div>
      </>
    );
  }

  return (
    <>
      <ThemeToggle />
      <Dashboard connection={connection} onDisconnect={handleDisconnect} />
    </>
  );
}
