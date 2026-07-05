import sql, { ConnectionPool } from "mssql";

export interface ConnectionInput {
  server: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

let pool: ConnectionPool | null = null;
let activeConnectionMeta: { server: string; database: string; user: string } | null = null;

function toConfig(input: ConnectionInput): sql.config {
  return {
    server: input.server,
    port: input.port ?? 1433,
    database: input.database,
    user: input.user,
    password: input.password,
    options: {
      encrypt: input.encrypt ?? true,
      trustServerCertificate: input.trustServerCertificate ?? true,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: 15000,
    connectionTimeout: 10000,
  };
}

export async function connect(input: ConnectionInput): Promise<void> {
  const config = toConfig(input);
  const newPool = new sql.ConnectionPool(config);
  await newPool.connect();

  if (pool) {
    await pool.close().catch(() => undefined);
  }

  pool = newPool;
  activeConnectionMeta = { server: input.server, database: input.database, user: input.user };
}

export async function testConnection(input: ConnectionInput): Promise<void> {
  const config = toConfig(input);
  const testPool = new sql.ConnectionPool(config);
  try {
    await testPool.connect();
    await testPool.request().query("SELECT 1 AS ok");
  } finally {
    await testPool.close().catch(() => undefined);
  }
}

export function getPool(): ConnectionPool {
  if (!pool) {
    throw new Error("Not connected to a database yet");
  }
  return pool;
}

export function isConnected(): boolean {
  return pool !== null && pool.connected;
}

export function getActiveConnectionMeta() {
  return activeConnectionMeta;
}

export async function disconnect(): Promise<void> {
  if (pool) {
    await pool.close().catch(() => undefined);
  }
  pool = null;
  activeConnectionMeta = null;
}
