import { useEffect, useState } from "react";
import { api } from "./api";
import { ConnectionForm } from "./components/ConnectionForm";
import { Overview } from "./components/Overview";
import { TopQueriesTable } from "./components/TopQueriesTable";
import { ActiveSessionsTable } from "./components/ActiveSessionsTable";
import { BlockingChain } from "./components/BlockingChain";
import { WaitStatsTable } from "./components/WaitStatsTable";
import type { ConnectionMeta } from "./types";

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
        <ConnectionForm onConnected={setConnection} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="app-header">
        <h1>SQL Performance Monitor</h1>
        <div className="connection-info">
          <span>
            {connection.loginName}@{connection.server} / {connection.database}
          </span>
          <button onClick={handleDisconnect}>Disconnect</button>
        </div>
      </header>

      <main className="dashboard">
        <Overview />
        <div className="dashboard-row">
          <BlockingChain />
        </div>
        <div className="dashboard-row">
          <TopQueriesTable />
        </div>
        <div className="dashboard-row two-col">
          <ActiveSessionsTable />
          <WaitStatsTable />
        </div>
      </main>
    </div>
  );
}
