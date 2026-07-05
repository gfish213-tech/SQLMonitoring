import type {
  ActiveSessionRow,
  BlockingRow,
  ConnectionForm,
  ConnectionMeta,
  OverviewStats,
  TopQueryMetric,
  TopQueryRow,
  WaitStatRow,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return body as T;
}

function toConnectionPayload(form: ConnectionForm) {
  return {
    server: form.server,
    port: form.port ? Number(form.port) : undefined,
    database: form.database,
    user: form.user,
    password: form.password,
    encrypt: form.encrypt,
    trustServerCertificate: form.trustServerCertificate,
  };
}

export const api = {
  testConnection: (form: ConnectionForm) =>
    request<{ ok: boolean }>("/connection/test", {
      method: "POST",
      body: JSON.stringify(toConnectionPayload(form)),
    }),

  connect: (form: ConnectionForm) =>
    request<{ ok: boolean; connection: ConnectionMeta }>("/connection", {
      method: "POST",
      body: JSON.stringify(toConnectionPayload(form)),
    }),

  disconnect: () => request<{ ok: boolean }>("/connection/disconnect", { method: "POST" }),

  status: () => request<{ connected: boolean; connection: ConnectionMeta | null }>("/connection/status"),

  overview: () => request<OverviewStats>("/overview"),

  topQueries: (metric: TopQueryMetric, limit = 25) =>
    request<TopQueryRow[]>(`/queries/top?metric=${metric}&limit=${limit}`),

  sessions: () => request<ActiveSessionRow[]>("/sessions"),

  blocking: () => request<BlockingRow[]>("/blocking"),

  waits: (limit = 20) => request<WaitStatRow[]>(`/waits?limit=${limit}`),
};
