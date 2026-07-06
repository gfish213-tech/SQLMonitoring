import sql, { ConnectionPool } from "mssql/msnodesqlv8";

export interface ConnectionInput {
  server: string;
  port?: number;
  database: string;
  instanceName?: string;
  encrypt?: boolean;
}

export interface ConnectionMeta {
  server: string;
  database: string;
  loginName: string;
}

interface SysadminCheckRow {
  is_sysadmin: number | null;
  login_name: string;
}

let pool: ConnectionPool | null = null;
let activeConnectionMeta: ConnectionMeta | null = null;

function toConfig(input: ConnectionInput): sql.config {
  return {
    driver: "msnodesqlv8",
    server: input.server,
    port: input.port ?? 1433,
    database: input.database,
    options: {
      instanceName: input.instanceName || undefined,
      trustedConnection: true,
      encrypt: input.encrypt ?? false,
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

function assertSysadmin(row: SysadminCheckRow | undefined): asserts row is SysadminCheckRow {
  if (!row || row.is_sysadmin !== 1) {
    const who = row?.login_name ? ` Connected as '${row.login_name}'.` : "";
    throw new Error(`Access denied: this Windows login is not a member of the sysadmin server role.${who}`);
  }
}

// The msnodesqlv8 native driver reports errors as plain objects ({ message, code, sqlstate, ... }),
// not Error instances. mssql's ConnectionError only preserves .message when the source is
// `instanceof Error`, so a plain-object error gets stringified wholesale into "[object Object]" and
// its real diagnostic text is lost. Detect that and surface an actionable message instead.
function normalizeConnectionError(err: unknown): Error {
  if (err instanceof Error && err.message && err.message !== "[object Object]") {
    return err;
  }
  const code = (err as { code?: string | number })?.code;
  return new Error(
    `Could not connect to SQL Server${code ? ` (code ${code})` : ""}. Check that the server name, ` +
      "instance name, and port are correct, that SQL Server allows remote TCP connections, that the " +
      "SQL Server Browser service is running if you specified an instance name, and that the ODBC " +
      "driver on this host can reach it."
  );
}

// Opens a pool using the caller's Windows identity (trusted connection) and verifies
// it's a sysadmin before handing it back. Closes the pool itself on any failure.
async function openVerifiedPool(input: ConnectionInput): Promise<{ pool: ConnectionPool; loginName: string }> {
  const config = toConfig(input);
  const newPool = new sql.ConnectionPool(config);

  try {
    await newPool.connect();
    const result = await newPool.request().query<SysadminCheckRow>(
      "SELECT CAST(IS_SRVROLEMEMBER('sysadmin') AS INT) AS is_sysadmin, SUSER_SNAME() AS login_name"
    );
    assertSysadmin(result.recordset[0]);
    return { pool: newPool, loginName: result.recordset[0].login_name };
  } catch (err) {
    await newPool.close().catch(() => undefined);
    throw normalizeConnectionError(err);
  }
}

export async function connect(input: ConnectionInput): Promise<ConnectionMeta> {
  const { pool: newPool, loginName } = await openVerifiedPool(input);

  if (pool) {
    await pool.close().catch(() => undefined);
  }

  pool = newPool;
  activeConnectionMeta = { server: input.server, database: input.database, loginName };
  return activeConnectionMeta;
}

export async function testConnection(input: ConnectionInput): Promise<void> {
  const { pool: testPool } = await openVerifiedPool(input);
  await testPool.close().catch(() => undefined);
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
