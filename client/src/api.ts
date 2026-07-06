import type { ConnectionMeta, ServerListEntry, TriageData } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  // Guard against non-JSON responses (a proxy's HTML error page, the server mid-restart, etc.)
  // so the user sees a readable message instead of a JSON.parse SyntaxError.
  const text = await res.text();
  let body: { error?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "The server returned an unreadable (non-JSON) response." : `Request failed with status ${res.status}`);
  }

  if (!res.ok) {
    const message = typeof body.error === "string" && body.error.trim() ? body.error : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  servers: () => request<ServerListEntry[]>("/connection/servers"),

  testConnection: (server: string) =>
    request<{ ok: boolean }>("/connection/test", { method: "POST", body: JSON.stringify({ server }) }),

  connect: (server: string) =>
    request<{ ok: boolean; connection: ConnectionMeta }>("/connection", { method: "POST", body: JSON.stringify({ server }) }),

  disconnect: () => request<{ ok: boolean }>("/connection/disconnect", { method: "POST" }),

  status: () => request<{ connected: boolean; connection: ConnectionMeta | null }>("/connection/status"),

  triage: () => request<TriageData>("/triage"),
};
