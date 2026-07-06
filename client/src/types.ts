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
  writes: number;
  elapsedMs: number;
  waitType: string | null;
  blockingSessionId: number | null;
  tempdbMb: number | null;
  queryText: string | null;
}

export interface CurrentWaitRow {
  sessionId: number;
  waitType: string;
  waitDurationMs: number;
  resourceDescription: string | null;
  databaseName: string | null;
}

export interface PressureStats {
  signalWaitPercent: number | null;
  pageLifeExpectancy: number | null;
  bufferCacheHitRatio: number | null;
  pendingMemoryGrants: number;
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
  | "deadlocks";

export interface TriageData {
  overview: OverviewStats;
  blocking: LeadBlocker[];
  longOps: LongOpRow[];
  agentJobs: AgentJobRow[];
  consumers: ConsumerRow[];
  waits: CurrentWaitRow[];
  pressure: PressureStats;
  tempdb: TempdbStats;
  logSpace: LogSpaceRow[];
  ioLatency: IoLatencyRow[];
  autogrowth: AutogrowthEvent[];
  deadlocks: DeadlockEvent[];
  volumeSpace: VolumeSpaceRow[];
}
