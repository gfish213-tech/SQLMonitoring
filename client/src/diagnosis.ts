import type { TriageData } from "./types";
import { formatMs } from "./format";

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  severity: Severity;
  panel: string;
  title: string;
  detail: string;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 2, warning: 1, info: 0 };

// Heuristic triage: scores each panel's data against thresholds that separate "normal" from
// "worth a look" from "very likely the cause," so the top finding can be surfaced as a plain-
// language answer instead of making a DBA scan all 11 panels themselves.
export function diagnose(data: TriageData): Finding[] {
  const findings: Finding[] = [];

  for (const lead of data.blocking) {
    const blockedCount = lead.blockedSessions.length;
    if (blockedCount === 0) continue;
    const maxWaitMs = Math.max(...lead.blockedSessions.map((b) => b.waitTimeMs));
    const severity: Severity = maxWaitMs > 30000 || blockedCount >= 3 ? "critical" : "warning";
    const idleNote = lead.isIdleWithOpenTransaction
      ? ` — idle with an open transaction (${lead.openTransactionCount} open tran${lead.openTransactionCount === 1 ? "" : "s"})`
      : "";
    findings.push({
      severity,
      panel: "Blocking",
      title: `Session ${lead.sessionId} is blocking ${blockedCount} other session${blockedCount === 1 ? "" : "s"}`,
      detail: `${lead.loginName ?? "unknown login"}${idleNote} on ${lead.databaseName ?? "an unknown database"} — longest wait ${formatMs(maxWaitMs)}.`,
    });
  }

  for (const op of data.longOps) {
    const severity: Severity = op.elapsedMs > 10 * 60000 ? "warning" : "info";
    const pct = op.percentComplete != null ? ` (${op.percentComplete.toFixed(0)}% complete)` : "";
    findings.push({
      severity,
      panel: "Long-running operation",
      title: `${op.command} running on ${op.databaseName ?? "an unknown database"}${pct}`,
      detail: `Running for ${formatMs(op.elapsedMs)}, started by ${op.loginName ?? "unknown"}.`,
    });
  }

  for (const job of data.agentJobs) {
    if (job.cpuTimeMs != null && job.cpuTimeMs > 60000) {
      findings.push({
        severity: "info",
        panel: "Agent job",
        title: `Job "${job.jobName}" is running`,
        detail: `CPU time ${formatMs(job.cpuTimeMs)} so far${job.waitType ? `, currently waiting on ${job.waitType}` : ""}.`,
      });
    }
  }

  if (data.pressure.signalWaitPercent != null && data.pressure.signalWaitPercent > 25) {
    findings.push({
      severity: data.pressure.signalWaitPercent > 40 ? "critical" : "warning",
      panel: "CPU pressure",
      title: `CPU pressure: ${data.pressure.signalWaitPercent.toFixed(1)}% signal wait`,
      detail: "More than a quarter of total wait time is spent waiting for a CPU to free up, not for a resource — the server is CPU-bound.",
    });
  }

  if (data.pressure.pageLifeExpectancy != null && data.pressure.pageLifeExpectancy < 300) {
    findings.push({
      severity: "warning",
      panel: "Memory pressure",
      title: `Low page life expectancy: ${data.pressure.pageLifeExpectancy}s`,
      detail: "Pages are being flushed from the buffer cache quickly, a common sign of memory pressure.",
    });
  }

  if (data.pressure.pendingMemoryGrants > 0) {
    findings.push({
      severity: "warning",
      panel: "Memory pressure",
      title: `${data.pressure.pendingMemoryGrants} quer${data.pressure.pendingMemoryGrants === 1 ? "y is" : "ies are"} waiting on a memory grant`,
      detail: "Queries can't get the memory they need to start running — usually memory pressure or a runaway query elsewhere.",
    });
  }

  if (data.tempdb.totalDataFileMb > 0) {
    const usedPercent = (data.tempdb.usedMb / data.tempdb.totalDataFileMb) * 100;
    if (usedPercent > 90) {
      const top = data.tempdb.topAllocators[0];
      findings.push({
        severity: "critical",
        panel: "TempDB",
        title: `TempDB is ${usedPercent.toFixed(0)}% full`,
        detail: `${data.tempdb.usedMb.toFixed(0)} MB of ${data.tempdb.totalDataFileMb.toFixed(0)} MB used${
          top ? ` — top consumer: session ${top.sessionId} (${top.loginName ?? "unknown"})` : ""
        }.`,
      });
    }
  }

  for (const log of data.logSpace) {
    findings.push({
      severity: log.logUsedPercent > 90 ? "critical" : "warning",
      panel: "Transaction log",
      title: `${log.databaseName} log is ${log.logUsedPercent.toFixed(0)}% full`,
      detail: log.logUsedPercent > 90 ? "A full log halts all writes to this database until it's freed up." : "Worth checking before it fills up completely.",
    });
  }

  for (const io of data.ioLatency) {
    const worst = Math.max(io.avgReadLatencyMs ?? 0, io.avgWriteLatencyMs ?? 0);
    findings.push({
      severity: worst > 100 ? "critical" : "warning",
      panel: "Disk latency",
      title: `${io.databaseName}: ${worst.toFixed(0)}ms average I/O latency`,
      detail: `${io.fileName} — normal is under ~15ms; this can cause broad slowness for anything touching this file.`,
    });
  }

  for (const ev of data.autogrowth) {
    findings.push({
      severity: ev.durationMs > 5000 ? "warning" : "info",
      panel: "Autogrowth",
      title: `${ev.databaseName ?? "A database"}'s ${ev.eventType.toLowerCase()} file grew`,
      detail: `Took ${formatMs(ev.durationMs)} at ${new Date(ev.startTime).toLocaleTimeString()} — can cause a brief freeze for anything touching that file.`,
    });
  }

  if (data.deadlocks.length > 0) {
    const latest = data.deadlocks[0];
    findings.push({
      severity: "info",
      panel: "Deadlocks",
      title: `${data.deadlocks.length} recent deadlock${data.deadlocks.length === 1 ? "" : "s"}`,
      detail: `Most recent at ${new Date(latest.timestamp).toLocaleTimeString()} — already resolved automatically by SQL Server, but worth reviewing if it keeps recurring.`,
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
