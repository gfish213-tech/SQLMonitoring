import fs from "fs";
import path from "path";

export interface ServerListEntry {
  label: string;
  server: string;
  environment?: string;
  database?: string;
  port?: number;
  instanceName?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

// Re-read from disk on every call (small file) so editing config/servers.json takes effect
// immediately, without a rebuild or restart — that's the whole point of pulling this out of
// code and into a plain JSON file the user edits directly.
const CONFIG_PATH = path.resolve(__dirname, "../config/servers.json");

export function getServerList(): ServerListEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    throw new Error(`Server list config not found at ${CONFIG_PATH}. Add entries there (see README).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config/servers.json is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("config/servers.json must be a JSON array of server entries.");
  }

  return parsed.map((entry, i) => {
    const e = entry as Partial<ServerListEntry>;
    if (!e.label || !e.server) {
      throw new Error(`config/servers.json entry #${i + 1} is missing "label" or "server".`);
    }
    return e as ServerListEntry;
  });
}

export function findServerEntry(server: string): ServerListEntry | undefined {
  return getServerList().find((e) => e.server === server);
}
