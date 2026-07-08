import { useEffect, useState } from "react";
import { api } from "../api";
import type { ConnectionMeta, ServerListEntry } from "../types";

function environmentClass(env?: string): string {
  const e = (env ?? "").toLowerCase();
  if (e.includes("prod")) return "env-prod";
  if (e.includes("staging")) return "env-staging";
  if (e.includes("dev")) return "env-dev";
  if (e.includes("no longer")) return "env-deprecated";
  return "";
}

// Dev first (safest to pick by accident), then Staging, then Production last (the one place a
// wrong click costs the most) - anything unrecognized (including "No Longer Supported") sorts
// after Production rather than being interleaved with real environments.
function environmentRank(env?: string): number {
  const e = (env ?? "").toLowerCase();
  if (e.includes("dev")) return 0;
  if (e.includes("staging")) return 1;
  if (e.includes("prod")) return 2;
  return 3;
}

function sortServers(list: ServerListEntry[]): ServerListEntry[] {
  return [...list].sort((a, b) => environmentRank(a.environment) - environmentRank(b.environment) || a.label.localeCompare(b.label));
}

export function ServerPicker({ onConnected }: { onConnected: (meta: ConnectionMeta) => void }) {
  const [servers, setServers] = useState<ServerListEntry[] | null>(null);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "connecting">("idle");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .servers()
      .then((list) => {
        const sorted = sortServers(list);
        setServers(sorted);
        if (sorted.length > 0) setSelected(sorted[0].server);
      })
      .catch((err) => setLoadError((err as Error).message));
  }, []);

  async function handleTest() {
    setStatus("testing");
    setMessage(null);
    try {
      await api.testConnection(selected);
      setMessage({ type: "success", text: "Connection succeeded." });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setStatus("idle");
    }
  }

  async function handleConnect() {
    setStatus("connecting");
    setMessage(null);
    try {
      const result = await api.connect(selected);
      onConnected(result.connection);
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
      setStatus("idle");
    }
  }

  return (
    <div className="connection-card">
      <h1>SQL Performance Monitor</h1>
      <p className="subtitle">
        Pick a server to see what's happening on it right now. Connects using this application's
        Windows account — the account must be a member of the <code>sysadmin</code> server role.
      </p>

      {loadError && <div className="message error">Could not load server list: {loadError}</div>}

      {servers && (
        <div className="connection-form">
          <label>
            Server
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {servers.map((s) => (
                <option key={s.server} value={s.server}>
                  {s.label} {s.environment ? `(${s.environment})` : ""}
                </option>
              ))}
            </select>
          </label>

          {servers.find((s) => s.server === selected)?.environment && (
            <div className={`env-badge ${environmentClass(servers.find((s) => s.server === selected)?.environment)}`}>
              {servers.find((s) => s.server === selected)?.environment}
            </div>
          )}

          {message && <div className={`message ${message.type}`}>{message.text}</div>}

          <div className="button-row">
            <button type="button" onClick={handleTest} disabled={status !== "idle" || !selected}>
              {status === "testing" ? "Testing..." : "Test Connection"}
            </button>
            <button type="button" className="primary" onClick={handleConnect} disabled={status !== "idle" || !selected}>
              {status === "connecting" ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
