import { Router } from "express";
import { connect, testConnection, disconnect, isConnected, getActiveConnectionMeta, ConnectionInput } from "../db";

const router = Router();

function parseConnectionInput(body: unknown): ConnectionInput {
  const b = body as Partial<ConnectionInput> & { port?: string | number };
  if (!b.server || !b.database || !b.user || typeof b.password !== "string") {
    throw new Error("server, database, user, and password are required");
  }
  return {
    server: String(b.server),
    port: b.port !== undefined ? Number(b.port) : undefined,
    database: String(b.database),
    user: String(b.user),
    password: b.password,
    encrypt: b.encrypt,
    trustServerCertificate: b.trustServerCertificate,
  };
}

router.post("/test", async (req, res) => {
  try {
    const input = parseConnectionInput(req.body);
    await testConnection(input);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = parseConnectionInput(req.body);
    await connect(input);
    res.json({ ok: true, connection: getActiveConnectionMeta() });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/status", (_req, res) => {
  res.json({ connected: isConnected(), connection: getActiveConnectionMeta() });
});

router.post("/disconnect", async (_req, res) => {
  await disconnect();
  res.json({ ok: true });
});

export default router;
