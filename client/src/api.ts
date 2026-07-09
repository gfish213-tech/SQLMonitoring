import type { ConnectionMeta, DashboardTab, ServerListEntry, TriageData } from "./types";

// Mirrors the {type:"progress"|"done"|"error"} lines dashboard.ts's /triage endpoint streams as
// newline-delimited JSON - see the server-side comment on that route for why (a Full Refresh can
// take several seconds across many individually-costly checks, and a single opaque "Refreshing..."
// spinner can't tell a DBA whether it's almost done or stuck on one specific slow check).
export type TriageProgressEvent = { panel: string; ok: boolean; ms: number };

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

  triage: (mode: "quick" | "full", onProgress: (event: TriageProgressEvent) => void) => triageStream(mode, onProgress),

  refreshPanel: (tab: DashboardTab) => request<Partial<TriageData>>(`/triage/panel/${tab}`),
};

// Reads /triage's newline-delimited JSON stream as it arrives, forwarding each {type:"progress"}
// line to onProgress the instant that individual check finishes (not when the whole batch does)
// and resolving with the final {type:"done"} payload. A non-2xx response (e.g. 409 "not
// connected") never reaches the stream at all - requireConnection's middleware responds with a
// normal single JSON body before the route handler runs - so that case is handled the same way
// request() above does, before falling into stream-reading.
async function triageStream(mode: "quick" | "full", onProgress: (event: TriageProgressEvent) => void): Promise<TriageData> {
  const res = await fetch(`/api/triage?mode=${mode}`, { headers: { "Content-Type": "application/json" } });

  if (!res.ok) {
    const text = await res.text();
    let body: { error?: unknown } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // fall through to the generic status-based message below
    }
    const message = typeof body.error === "string" && body.error.trim() ? body.error : `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  if (!res.body) {
    // No streaming body support - fall back to reading it all at once and parsing the last line.
    const text = await res.text();
    return parseDoneLine(text.trim().split("\n").pop() ?? "");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TriageData | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "progress") onProgress({ panel: event.panel, ok: event.ok, ms: event.ms });
      else if (event.type === "done") result = event.data as TriageData;
      else if (event.type === "error") throw new Error(event.message);
    }
  }

  if (!result) throw new Error("The server closed the connection before the refresh finished.");
  return result;
}

function parseDoneLine(line: string): TriageData {
  const event = JSON.parse(line);
  if (event.type === "error") throw new Error(event.message);
  if (event.type !== "done") throw new Error("The server closed the connection before the refresh finished.");
  return event.data as TriageData;
}
