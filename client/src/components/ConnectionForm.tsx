import { FormEvent, useState } from "react";
import { api } from "../api";
import type { ConnectionForm as ConnectionFormData, ConnectionMeta } from "../types";

const initialForm: ConnectionFormData = {
  server: "",
  port: "1433",
  database: "",
  user: "",
  password: "",
  encrypt: true,
  trustServerCertificate: true,
};

export function ConnectionForm({ onConnected }: { onConnected: (meta: ConnectionMeta) => void }) {
  const [form, setForm] = useState<ConnectionFormData>(initialForm);
  const [status, setStatus] = useState<"idle" | "testing" | "connecting">("idle");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  function update<K extends keyof ConnectionFormData>(key: K, value: ConnectionFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleTest(e: FormEvent) {
    e.preventDefault();
    setStatus("testing");
    setMessage(null);
    try {
      await api.testConnection(form);
      setMessage({ type: "success", text: "Connection succeeded." });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setStatus("idle");
    }
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setStatus("connecting");
    setMessage(null);
    try {
      const result = await api.connect(form);
      onConnected(result.connection);
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
      setStatus("idle");
    }
  }

  return (
    <div className="connection-card">
      <h1>SQL Performance Monitor</h1>
      <p className="subtitle">Connect to a SQL Server instance to start monitoring.</p>
      <form className="connection-form">
        <label>
          Server / Host
          <input value={form.server} onChange={(e) => update("server", e.target.value)} placeholder="localhost or db.example.com" required />
        </label>
        <label>
          Port
          <input value={form.port} onChange={(e) => update("port", e.target.value)} placeholder="1433" />
        </label>
        <label>
          Database
          <input value={form.database} onChange={(e) => update("database", e.target.value)} placeholder="master" required />
        </label>
        <label>
          Username
          <input value={form.user} onChange={(e) => update("user", e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} required />
        </label>
        <div className="checkbox-row">
          <label>
            <input type="checkbox" checked={form.encrypt} onChange={(e) => update("encrypt", e.target.checked)} />
            Encrypt connection
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.trustServerCertificate}
              onChange={(e) => update("trustServerCertificate", e.target.checked)}
            />
            Trust server certificate
          </label>
        </div>

        {message && <div className={`message ${message.type}`}>{message.text}</div>}

        <div className="button-row">
          <button type="button" onClick={handleTest} disabled={status !== "idle"}>
            {status === "testing" ? "Testing..." : "Test Connection"}
          </button>
          <button type="button" className="primary" onClick={handleConnect} disabled={status !== "idle"}>
            {status === "connecting" ? "Connecting..." : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
