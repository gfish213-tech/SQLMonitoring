export interface ConnectionForm {
  server: string;
  port: string;
  database: string;
  instanceName: string;
  encrypt: boolean;
}

export interface ConnectionMeta {
  server: string;
  database: string;
  loginName: string;
}

export interface OverviewStats {
  cpuCount: number;
  sqlServerStartTime: string;
  activeSessionCount: number;
  activeRequestCount: number;
  blockedRequestCount: number;
  bufferCacheHitRatio: number | null;
  pageLifeExpectancy: number | null;
  batchRequestsPerSec: number | null;
}

export type TopQueryMetric = "cpu" | "duration" | "reads" | "writes" | "executions";

export interface TopQueryRow {
  queryText: string;
  databaseName: string | null;
  executionCount: number;
  totalWorkerTimeMs: number;
  avgWorkerTimeMs: number;
  totalElapsedTimeMs: number;
  avgElapsedTimeMs: number;
  totalLogicalReads: number;
  avgLogicalReads: number;
  totalLogicalWrites: number;
  avgLogicalWrites: number;
  lastExecutionTime: string;
}

export interface ActiveSessionRow {
  sessionId: number;
  loginName: string;
  hostName: string | null;
  programName: string | null;
  status: string;
  command: string | null;
  databaseName: string | null;
  cpuTimeMs: number;
  logicalReads: number;
  writes: number;
  waitType: string | null;
  waitTimeMs: number | null;
  blockingSessionId: number | null;
  totalElapsedTimeMs: number | null;
  queryText: string | null;
}

export interface BlockingRow {
  sessionId: number;
  blockingSessionId: number;
  waitType: string | null;
  waitTimeMs: number;
  waitResource: string | null;
  loginName: string | null;
  hostName: string | null;
  databaseName: string | null;
  queryText: string | null;
}

export interface WaitStatRow {
  waitType: string;
  waitTimeMs: number;
  waitingTasksCount: number;
  avgWaitTimeMs: number;
  signalWaitTimeMs: number;
}
