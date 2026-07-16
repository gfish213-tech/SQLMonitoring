export interface ServerListEntry {
  label: string;
  server: string;
  environment?: string;
}

export interface ConnectionMeta {
  server: string;
  database: string;
  loginName: string;
  odbcDriver: string;
  label?: string;
  environment?: string;
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
  planCacheMb: number;
  adhocPlanCacheMb: number;
  adhocPlanCachePercent: number | null;
  singleUseAdhocPlanCount: number;
  singleUseAdhocPlanMb: number;
}

export interface BlockedSession {
  sessionId: number;
  blockedBy: number;
  waitType: string | null;
  waitTimeMs: number;
  waitResource: string | null;
  loginName: string | null;
  databaseName: string | null;
  queryText: string | null;
}

export interface LeadBlocker {
  sessionId: number;
  loginName: string | null;
  hostName: string | null;
  programName: string | null;
  status: string;
  isIdleWithOpenTransaction: boolean;
  openTransactionCount: number;
  lastStatementText: string | null;
  lastRequestEndTime: string | null;
  databaseName: string | null;
  blockedSessions: BlockedSession[];
}

export interface LongOpRow {
  sessionId: number;
  command: string;
  databaseName: string | null;
  percentComplete: number | null;
  startTime: string;
  estimatedCompletionTime: string | null;
  elapsedMs: number;
  loginName: string | null;
  queryText: string | null;
}

export interface AgentJobRow {
  jobName: string;
  startTime: string;
  sessionId: number | null;
  cpuTimeMs: number | null;
  logicalReads: number | null;
  writes: number | null;
  waitType: string | null;
}

export interface ConsumerRow {
  sessionId: number;
  loginName: string;
  hostName: string | null;
  programName: string | null;
  databaseName: string | null;
  command: string | null;
  cpuTimeMs: number;
  logicalReads: number;
  physicalReads: number;
  writes: number;
  elapsedMs: number;
  waitType: string | null;
  blockingSessionId: number | null;
  tempdbMb: number | null;
  memoryGrantMb: number | null;
  memoryGrantPending: boolean;
  queryText: string | null;
}

export interface CurrentWaitRow {
  sessionId: number;
  waitType: string;
  waitDurationMs: number;
  resourceDescription: string | null;
  databaseName: string | null;
  taskCount: number;
}

export interface PressureStats {
  signalWaitPercent: number | null;
  pageLifeExpectancy: number | null;
  bufferCacheHitRatio: number | null;
  pendingMemoryGrants: number;
  runnableTasksCount: number;
  workQueueCount: number;
}

export interface TempdbAllocator {
  sessionId: number;
  loginName: string | null;
  tempdbAllocatedMb: number;
}

export interface TempdbStats {
  totalDataFileMb: number;
  usedMb: number;
  freeMb: number;
  userObjectsMb: number;
  internalObjectsMb: number;
  versionStoreMb: number;
  topAllocators: TempdbAllocator[];
}

export interface LogSpaceRow {
  databaseName: string;
  logSizeMb: number;
  logUsedPercent: number;
}

export interface VlfCountRow {
  databaseName: string;
  vlfCount: number;
}

export interface IoLatencyRow {
  databaseName: string;
  fileName: string;
  avgReadLatencyMs: number | null;
  avgWriteLatencyMs: number | null;
  currentReadLatencyMs: number | null;
  currentWriteLatencyMs: number | null;
  readIops: number | null;
  writeIops: number | null;
  readThroughputMBps: number | null;
  writeThroughputMBps: number | null;
}

export interface AutogrowthEvent {
  databaseName: string | null;
  fileName: string | null;
  eventType: string;
  startTime: string;
  durationMs: number;
}

export interface DeadlockEvent {
  timestamp: string;
  xml: string;
}

export interface VolumeSpaceRow {
  volumeMountPoint: string;
  logicalVolumeName: string | null;
  totalGb: number;
  freeGb: number;
  freePercent: number;
}

export interface TopScannedTable {
  databaseName: string;
  tableName: string;
  totalScans: number;
  totalSeeks: number;
  totalLookups: number;
}

export interface UnusedIndex {
  databaseName: string;
  tableName: string;
  indexId: number;
  totalWrites: number;
}

export interface IndexStats {
  topScannedTables: TopScannedTable[];
  unusedIndexes: UnusedIndex[];
}

export interface QueryStoreRegression {
  databaseName: string;
  queryId: number;
  queryText: string;
  recentAvgDurationMs: number;
  priorAvgDurationMs: number;
  recentAvgCpuMs: number;
  priorAvgCpuMs: number;
  regressionRatio: number;
  executionCount: number;
}

export interface ErrorLogEntry {
  timestamp: string;
  severity: number | null;
  message: string;
}

// The dashboard's tab keys - shared between App.tsx (which owns the active tab) and
// DiagnosisSummary.tsx (which maps a Finding's panel name to a tab for its "View details" link).
export type DashboardTab =
  | "overview"
  | "blocking"
  | "consumers"
  | "longops"
  | "agentjobs"
  | "waits"
  | "logspace"
  | "iolatency"
  | "autogrowth"
  | "deadlocks"
  | "querystore"
  | "errorlog"
  | "indexes";

// Refresh has two modes (see App.tsx / useTriage.ts): "quick" runs only small, single-pass
// queries (bounded system DMVs, no per-row scans, no XML shredding, no disk/OS syscalls) and is
// the default for the initial load, manual Refresh, and auto-refresh; "full" adds everything
// with a larger scan surface. Quick-only fields are always present; full-only fields are
// `undefined` until an explicit Full Refresh has run at least once - components must treat
// `undefined` ("not checked yet") differently from an empty array ("checked, nothing found").
export interface TriageData {
  overview: OverviewStats;
  blocking: LeadBlocker[];
  longOps: LongOpRow[];
  agentJobs: AgentJobRow[];
  waits: CurrentWaitRow[];
  pressure: PressureStats;
  logSpace: LogSpaceRow[];
  consumers: ConsumerRow[];
  tempdb?: TempdbStats;
  vlfCounts?: VlfCountRow[];
  ioLatency?: IoLatencyRow[];
  autogrowth?: AutogrowthEvent[];
  deadlocks?: DeadlockEvent[];
  volumeSpace?: VolumeSpaceRow[];
  queryStoreRegressions?: QueryStoreRegression[];
  errorLogEntries?: ErrorLogEntry[];
  indexStats?: IndexStats;
}
