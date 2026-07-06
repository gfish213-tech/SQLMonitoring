import sql, { ConnectionPool } from "mssql/msnodesqlv8";
import { buildConnectionString } from "@tediousjs/connection-string";

export interface ConnectionInput {
  server: string;
  port?: number;
  database: string;
  instanceName?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  odbcDriver?: string;
}

export interface ConnectionMeta {
  server: string;
  database: string;
  loginName: string;
  odbcDriver: string;
}

interface SysadminCheckRow {
  is_sysadmin: number | null;
  login_name: string;
}

// Minimal surface of the native msnodesqlv8 module (loaded lazily via require so the
// server can boot, and typecheck, on hosts where the native addon isn't built).
interface NativeConnection {
  promises: { close: () => Promise<void> };
}
interface NativeSqlClient {
  promises: { open: (connStr: string) => Promise<NativeConnection> };
}

let pool: ConnectionPool | null = null;
let activeConnectionMeta: ConnectionMeta | null = null;

// mssql's own msnodesqlv8 connection-string builder hardcodes the driver name to the legacy,
// long-deprecated "SQL Server Native Client 11.0" on Windows (most machines only have the
// modern "ODBC Driver 17/18 for SQL Server" installed) and never wires up
// TrustServerCertificate at all. We build the connection string ourselves and pass it via
// `connectionString`, which mssql/lib/msnodesqlv8/connection-pool.js uses verbatim.
const DRIVER_CANDIDATES = [
  "ODBC Driver 18 for SQL Server",
  "ODBC Driver 17 for SQL Server",
  "SQL Server Native Client 11.0",
];

// Remembered across connects so later connections skip the probe sequence.
let workingDriver: string | null = null;

function buildConnStr(input: ConnectionInput, driver: string): string {
  return buildConnectionString({
    Driver: driver,
    Server: input.instanceName ? `${input.server}\\${input.instanceName}` : `${input.server},${input.port ?? 1433}`,
    Database: input.database,
    Trusted_Connection: true,
    Encrypt: input.encrypt ?? true,
    TrustServerCertificate: input.trustServerCertificate ?? false,
  });
}

interface DriverErrorInfo {
  message: string;
  sqlstate?: string;
}

// msnodesqlv8 reports errors as plain objects (or arrays of them) shaped
// { message, sqlstate, code }, not Error instances — which is why mssql's wrapping turns
// them into "[object Object]". Pull the real diagnostic text off whatever shape we get.
function extractDriverError(err: unknown): DriverErrorInfo {
  const first = Array.isArray(err) ? err[0] : err;
  if (first && typeof first === "object") {
    const o = first as { message?: unknown; sqlstate?: unknown };
    if (typeof o.message === "string" && o.message.length > 0) {
      return { message: o.message, sqlstate: typeof o.sqlstate === "string" ? o.sqlstate : undefined };
    }
  }
  if (first instanceof Error && first.message) {
    return { message: first.message };
  }
  return { message: String(first) };
}

// SQLSTATE IM002 = "data source name not found and no default driver specified" — the ODBC
// manager's way of saying the named driver isn't installed. That's the only failure that
// should fall through to the next driver candidate; anything else (unreachable host, TLS,
// login) is a real diagnostic the user needs to see.
function isDriverNotInstalled(info: DriverErrorInfo): boolean {
  return info.sqlstate === "IM002" || /data source name not found|specified driver could not be loaded/i.test(info.message);
}

function loadNativeDriver(): NativeSqlClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("msnodesqlv8") as NativeSqlClient;
  } catch {
    throw new Error(
      "The native msnodesqlv8 driver is not built on this host. Run `npm install` in server/ " +
        "on a machine with the Microsoft ODBC Driver for SQL Server and a C++ build toolchain " +
        "(Windows is the supported platform for trusted-connection auth)."
    );
  }
}

// Finds an installed ODBC driver by probing candidates (18 -> 17 -> Native Client 11) with a
// raw native-driver open, and returns the working connection string. Raw errors from the
// probe carry the genuine ODBC diagnostic text that mssql's pool wrapping would destroy.
async function resolveConnectionString(input: ConnectionInput): Promise<string> {
  const native = loadNativeDriver();
  const candidates = input.odbcDriver
    ? [input.odbcDriver]
    : workingDriver
      ? [workingDriver, ...DRIVER_CANDIDATES.filter((d) => d !== workingDriver)]
      : DRIVER_CANDIDATES;

  let lastNotInstalled: DriverErrorInfo | null = null;
  for (const driver of candidates) {
    const connStr = buildConnStr(input, driver);
    try {
      const conn = await native.promises.open(connStr);
      await conn.promises.close().catch(() => undefined);
      workingDriver = driver;
      return connStr;
    } catch (err) {
      const info = extractDriverError(err);
      if (isDriverNotInstalled(info)) {
        lastNotInstalled = info;
        continue;
      }
      throw new Error(info.sqlstate ? `${info.message} (SQLSTATE ${info.sqlstate})` : info.message);
    }
  }

  throw new Error(
    `No usable SQL Server ODBC driver found on this host (tried: ${candidates.join(", ")}). ` +
      `Install "ODBC Driver 18 for SQL Server" from Microsoft. Last ODBC error: ${lastNotInstalled?.message ?? "unknown"}`
  );
}

// @types/mssql doesn't declare top-level `connectionString`, but the msnodesqlv8 pool
// (mssql/lib/msnodesqlv8/connection-pool.js) reads exactly that key at runtime.
function toPoolConfig(input: ConnectionInput, connectionString: string): sql.config & { connectionString: string } {
  return {
    driver: "msnodesqlv8",
    server: input.server,
    connectionString,
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

// Safety net for pool-phase failures: mssql's ConnectionError only preserves .message when
// the source error is `instanceof Error`, so a plain-object driver error gets stringified
// into "[object Object]". By this point the probe has already verified driver + reachability,
// so pool-phase failures are rare, but never show the user "[object Object]".
function normalizeConnectionError(err: unknown): Error {
  if (err instanceof Error && err.message && err.message !== "[object Object]") {
    return err;
  }
  const info = extractDriverError(err);
  if (info.message && info.message !== "[object Object]") {
    return new Error(info.sqlstate ? `${info.message} (SQLSTATE ${info.sqlstate})` : info.message);
  }
  return new Error("Could not connect to SQL Server (the driver reported an unreadable error). Check the server log for details.");
}

// Opens a pool using the caller's Windows identity (trusted connection) and verifies
// it's a sysadmin before handing it back. Closes the pool itself on any failure.
async function openVerifiedPool(input: ConnectionInput): Promise<{ pool: ConnectionPool; loginName: string }> {
  const connectionString = await resolveConnectionString(input);
  const newPool = new sql.ConnectionPool(toPoolConfig(input, connectionString));

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
  activeConnectionMeta = {
    server: input.server,
    database: input.database,
    loginName,
    odbcDriver: workingDriver ?? "unknown",
  };
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
