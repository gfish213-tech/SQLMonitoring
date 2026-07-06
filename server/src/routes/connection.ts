import { Router } from "express";
import { connect, testConnection, disconnect, isConnected, getActiveConnectionMeta, ConnectionInput } from "../db";
import { getServerList, findServerEntry } from "../serverList";

const router = Router();

// The client only ever sends the hostname picked from the dropdown; everything else
// (database, port, instance, encrypt, trust-cert) comes from config/servers.json so there's
// nothing to fill in or get wrong in the UI.
function toConnectionInput(body: unknown): ConnectionInput {
  const server = (body as { server?: unknown })?.server;
  if (!server || typeof server !== "string") {
    throw new Error("server is required");
  }
  const entry = findServerEntry(server);
  if (!entry) {
    throw new Error(`"${server}" is not in the configured server list.`);
  }
  return {
    server: entry.server,
    port: entry.port,
    database: entry.database || "master",
    instanceName: entry.instanceName,
    encrypt: entry.encrypt,
    trustServerCertificate: entry.trustServerCertificate,
  };
}

router.get("/servers", (_req, res) => {
  try {
    res.json(getServerList().map(({ label, server, environment }) => ({ label, server, environment })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/test", async (req, res) => {
  try {
    const input = toConnectionInput(req.body);
    await testConnection(input);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = toConnectionInput(req.body);
    const connection = await connect(input);
    const entry = findServerEntry(connection.server);
    res.json({ ok: true, connection: { ...connection, label: entry?.label, environment: entry?.environment } });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/status", (_req, res) => {
  const connection = getActiveConnectionMeta();
  const entry = connection ? findServerEntry(connection.server) : undefined;
  res.json({
    connected: isConnected(),
    connection: connection ? { ...connection, label: entry?.label, environment: entry?.environment } : null,
  });
});

router.post("/disconnect", async (_req, res) => {
  await disconnect();
  res.json({ ok: true });
});

export default router;
