import type { TriageData } from "./types";
import { formatMs } from "./format";

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  severity: Severity;
  panel: string;
  title: string;
  detail: string;
  /** Concrete first-response action for this finding — what a DBA should actually do about it,
   *  right now, mid-incident. Shown as a "What to do" line under the detail. */
  advice: string;
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
      advice: lead.isIdleWithOpenTransaction
        ? `The blocker isn't even running anything — it's sitting idle with an uncommitted transaction (often an app that crashed mid-transaction, or someone who ran BEGIN TRAN in SSMS and walked away). Contact ${
            lead.loginName ?? "the owner"
          } to COMMIT or ROLLBACK; if unreachable, KILL ${lead.sessionId} releases everyone immediately (its open transaction will roll back — check the last statement in the Blocking tab first to judge how much).`
        : `Check the blocker's current statement in the Blocking tab. If it's a legitimate batch that will finish soon, waiting may be cheapest; if it's runaway or non-critical, KILL ${lead.sessionId} releases all ${blockedCount} waiter${
            blockedCount === 1 ? "" : "s"
          } (its work rolls back — a long-running UPDATE/DELETE can take as long to roll back as it ran).`,
    });
  }

  for (const op of data.longOps) {
    const severity: Severity = op.elapsedMs > 10 * 60000 ? "warning" : "info";
    const pct = op.percentComplete != null ? ` (${op.percentComplete.toFixed(0)}% complete)` : "";
    const cmd = op.command.toUpperCase();
    const advice = cmd.includes("ROLLBACK")
      ? "Do NOT kill this — a rollback must finish, and killing it doesn't speed it up (it just keeps rolling back). Check % complete for how far along it is and let it run."
      : cmd.startsWith("BACKUP")
        ? "Usually let it finish — check the ETA in the Backups tab. Killing a backup is safe (nothing rolls back) but leaves you without that backup; only do it if the backup itself is what's dragging the server."
        : cmd.startsWith("RESTORE")
          ? "Let it finish if possible — check the ETA. Killing a restore leaves the database in a restoring state, not back where it started."
          : "Check the ETA and query text in the Backups tab. If it's expected maintenance, let it finish; if it's an unexpected heavy operation, killing it will roll back whatever it's already done — which can take as long as it ran.";
    findings.push({
      severity,
      panel: "Long-running operation",
      title: `${op.command} running on ${op.databaseName ?? "an unknown database"}${pct}`,
      detail: `Running for ${formatMs(op.elapsedMs)}, started by ${op.loginName ?? "unknown"}.`,
      advice,
    });
  }

  for (const job of data.agentJobs) {
    if (job.cpuTimeMs != null && job.cpuTimeMs > 60000) {
      findings.push({
        severity: "info",
        panel: "Agent job",
        title: `Job "${job.jobName}" is running`,
        detail: `CPU time ${formatMs(job.cpuTimeMs)} so far${job.waitType ? `, currently waiting on ${job.waitType}` : ""}.`,
        advice: `If this job is what's dragging the server and it can wait, stop it cleanly from SSMS → SQL Server Agent → Jobs → right-click "${job.jobName}" → Stop Job (safer than KILL — the job knows it was stopped and won't be left half-tracked). Check its schedule too: a heavy job firing during business hours may just need rescheduling.`,
      });
    }
  }

  if (data.pressure.signalWaitPercent != null && data.pressure.signalWaitPercent > 25) {
    findings.push({
      severity: data.pressure.signalWaitPercent > 40 ? "critical" : "warning",
      panel: "CPU pressure",
      title: `${data.pressure.signalWaitPercent.toFixed(1)}% of wait time is spent waiting for a CPU`,
      detail:
        "Over the sampled second, a large share of wait time was signal wait (waiting for a CPU to free up, not for a resource) — the server is CPU-bound right now.",
      advice:
        "Open the Consumers tab (it needs a Full Refresh to populate) to find who's burning the CPU — one runaway query is far more common than genuine undersizing. Look for a session with CPU time far above the rest; its query text tells you whether to kill it, or whether it's a bad plan (a scan where a seek should be) worth fixing properly.",
    });
  }

  if (data.pressure.pageLifeExpectancy != null && data.pressure.pageLifeExpectancy < 300) {
    findings.push({
      severity: "warning",
      panel: "Memory pressure",
      title: `Low page life expectancy: ${data.pressure.pageLifeExpectancy}s`,
      detail: "Pages are being flushed from the buffer cache quickly, a common sign of memory pressure.",
      advice:
        "Check the Consumers tab (needs a Full Refresh to populate) for a session with huge logical reads — one big table scan can flush the whole cache. Also check the Plan Cache stats on the Overview tab: a bloated ad-hoc plan cache steals this same memory. If PLE is chronically low with no single culprit, the server genuinely needs more RAM (or a lower max server memory ceiling is set than intended).",
    });
  }

  if (data.pressure.pendingMemoryGrants > 0) {
    findings.push({
      severity: "warning",
      panel: "Memory pressure",
      title: `${data.pressure.pendingMemoryGrants} quer${data.pressure.pendingMemoryGrants === 1 ? "y is" : "ies are"} waiting on a memory grant`,
      detail: "Queries can't get the memory they need to start running — usually memory pressure or a runaway query elsewhere.",
      advice:
        "Usually one query holding an oversized memory grant starves the rest — look in the Consumers tab (needs a Full Refresh to populate) for a long-running session doing big sorts/hashes (huge reads, SELECT with ORDER BY / joins over large tables). Killing or finishing that one typically releases the queue. Recurring cases are a bad plan or missing index on the greedy query.",
    });
  }

  if (data.pressure.workQueueCount > 0) {
    findings.push({
      severity: "critical",
      panel: "Worker threads",
      title: `${data.pressure.workQueueCount} request${data.pressure.workQueueCount === 1 ? "" : "s"} waiting for a worker thread`,
      detail: "SQL Server has run out of worker threads — new connections and requests can start timing out before they even get a chance to run.",
      advice:
        "Worker exhaustion is almost always a *symptom* of massive blocking (hundreds of sessions each holding a worker while they wait) — check the Blocking tab first and resolve the lead blocker; the workers free up on their own. Don't raise 'max worker threads' as a fix — it just delays the same wall. If the app is opening runaway connection counts, that's the real fix.",
    });
  } else if (data.pressure.runnableTasksCount > 0) {
    findings.push({
      severity: "warning",
      panel: "Worker threads",
      title: `${data.pressure.runnableTasksCount} task${data.pressure.runnableTasksCount === 1 ? " is" : "s are"} waiting for a free CPU core`,
      detail: "Tasks are ready to run but every scheduler is busy — true CPU/scheduler pressure right now, not just elevated wait times.",
      advice:
        "Same playbook as CPU pressure: find the top CPU burner in the Consumers tab (needs a Full Refresh to populate). One query going parallel across every core (a bad plan doing a huge scan) can starve everything else; killing it or fixing its plan/index usually clears this immediately.",
    });
  }

  if (data.overview.adhocPlanCachePercent != null && data.overview.adhocPlanCachePercent > 50 && data.overview.singleUseAdhocPlanMb > 256) {
    findings.push({
      severity: data.overview.singleUseAdhocPlanMb > 1024 ? "warning" : "info",
      panel: "Plan cache",
      title: `${data.overview.adhocPlanCachePercent.toFixed(0)}% of plan cache is ad-hoc plans`,
      detail: `${data.overview.singleUseAdhocPlanCount.toLocaleString()} single-use ad-hoc plans (${
        data.overview.singleUseAdhocPlanMb
      } MB) are likely never reused — this memory is competing with the buffer pool (data cache), which can drag down Page Life Expectancy.`,
      advice:
        "Immediate relief: DBCC FREESYSTEMCACHE('SQL Plans') frees the ad-hoc cache without touching stored-proc plans. Lasting fix: enable the server option 'optimize for ad hoc workloads' (sp_configure — safe, widely recommended; plans are only fully cached on second use), and get the offending application to use parameterized queries instead of concatenated SQL strings.",
    });
  }

  if (data.tempdb && data.tempdb.totalDataFileMb > 0) {
    const tempdb = data.tempdb;
    const usedPercent = (tempdb.usedMb / tempdb.totalDataFileMb) * 100;
    if (usedPercent > 90) {
      const top = tempdb.topAllocators[0];
      const versionStoreHeavy = tempdb.versionStoreMb > tempdb.usedMb * 0.5;
      findings.push({
        severity: "critical",
        panel: "TempDB",
        title: `TempDB is ${usedPercent.toFixed(0)}% full`,
        detail: `${tempdb.usedMb.toFixed(0)} MB of ${tempdb.totalDataFileMb.toFixed(0)} MB used${
          top ? ` — top consumer: session ${top.sessionId} (${top.loginName ?? "unknown"})` : ""
        }.`,
        advice: versionStoreHeavy
          ? "Most of the space is version store — that means one long-running transaction is preventing cleanup (snapshot isolation / RCSI keeps versions as long as the oldest transaction needs them). Find and commit/kill the oldest open transaction (check Blocking for idle-with-open-tran sessions); the version store then cleans itself up. Restarting SQL Server also resets tempdb, but that's a last resort."
          : `The used-space breakdown (Overview tab) says whether it's user objects (someone's #temp tables — ${
              top ? `session ${top.sessionId} is the top allocator; finishing or killing it releases its space` : "check Top Allocators for the culprit"
            }) or internal objects (spills from big sorts/hashes — find the heavy query in Consumers). If tempdb is simply undersized for normal load, grow the files during a calm window.`,
      });
    }
  }

  for (const log of data.logSpace) {
    findings.push({
      severity: log.logUsedPercent > 90 ? "critical" : "warning",
      panel: "Transaction log",
      title: `${log.databaseName} log is ${log.logUsedPercent.toFixed(0)}% full`,
      detail: log.logUsedPercent > 90 ? "A full log halts all writes to this database until it's freed up." : "Worth checking before it fills up completely.",
      advice: `First run SELECT log_reuse_wait_desc FROM sys.databases WHERE name = '${log.databaseName}' — it tells you exactly what's holding the log. LOG_BACKUP → take a transaction log backup NOW (BACKUP LOG — not a full backup, and don't shrink; shrinking doesn't free reusable space and it'll just regrow). ACTIVE_TRANSACTION → find and commit/kill the oldest open transaction (see Blocking). REPLICATION/AVAILABILITY_REPLICA → the log can't clear until that consumer catches up or is fixed.`,
    });
  }

  for (const vlf of data.vlfCounts ?? []) {
    if (vlf.vlfCount > 1000) {
      findings.push({
        severity: "warning",
        panel: "VLF count",
        title: `${vlf.databaseName}'s log has ${vlf.vlfCount.toLocaleString()} virtual log files`,
        detail: "A heavily fragmented log slows down recovery (restart, failover) and can slow log-heavy writes. Usually caused by repeated small autogrowth increments.",
        advice:
          "Not an emergency — fix during a calm window, not mid-incident: take a log backup, DBCC SHRINKFILE the log to near-zero, then manually regrow it to its working size in a few large chunks (e.g. 8GB steps). Then set the log file's autogrowth to a fixed size (say 1–4 GB), never a percentage, so it doesn't re-fragment.",
      });
    }
  }

  for (const io of data.ioLatency ?? []) {
    const worstAvg = Math.max(io.avgReadLatencyMs ?? 0, io.avgWriteLatencyMs ?? 0);
    const worstCurrent = Math.max(io.currentReadLatencyMs ?? 0, io.currentWriteLatencyMs ?? 0);
    const worst = Math.max(worstAvg, worstCurrent);
    const currentlyWorse = worstCurrent > worstAvg;
    findings.push({
      severity: worst > 100 ? "critical" : "warning",
      panel: "Disk latency",
      title: `${io.databaseName}: ${worst.toFixed(0)}ms ${currentlyWorse ? "in the last ~1s" : "average"} I/O latency`,
      detail: `${io.fileName} — normal is under ~15ms; this can cause broad slowness for anything touching this file.${
        currentlyWorse ? " Worse right now than its since-restart average, so this is an active spike, not old history." : ""
      }`,
      advice:
        "First rule out that SQL Server is the one hammering the disk: is a backup running (Backups tab), an ETL job (Agent Jobs), or a huge scan (Consumers tab)? Also check the host for antivirus scanning database files (they should be excluded) and, on a VM/SAN, whether a neighbor or storage-side job is eating the shared array. If latency is high with *low* IOPS/throughput, the storage itself is slow — take the IOPS and MB/s figures from the IO Latency tab to your storage team.",
    });
  }

  for (const vol of data.volumeSpace ?? []) {
    if (vol.freePercent < 15) {
      findings.push({
        severity: vol.freePercent < 5 ? "critical" : "warning",
        panel: "Disk space",
        title: `${vol.volumeMountPoint} has only ${vol.freePercent.toFixed(1)}% free space left`,
        detail: `${vol.freeGb} GB free of ${vol.totalGb} GB. Running out of space prevents data/log files from growing at all, which can halt the databases on this volume entirely.`,
        advice: `Free space on ${vol.volumeMountPoint} now: old backup files and forgotten copies of .bak/.trn files are the usual quick wins (never delete .mdf/.ldf/.ndf). If a runaway transaction log is what ate the drive, fix the log finding first — that's the cause, this is the symptom. Then get the volume extended; a data drive should never sit this close to full.`,
      });
    }
  }

  for (const ev of data.autogrowth ?? []) {
    findings.push({
      severity: ev.durationMs > 5000 ? "warning" : "info",
      panel: "Autogrowth",
      title: `${ev.databaseName ?? "A database"}'s ${ev.eventType.toLowerCase()} file grew`,
      detail: `Took ${formatMs(ev.durationMs)} at ${new Date(ev.startTime).toLocaleTimeString()} — can cause a brief freeze for anything touching that file.`,
      advice:
        "The event itself is already over — the fix is preventing the next one: pre-grow the file to its expected working size during a calm window, and set autogrowth to a fixed MB amount (not a percentage). For slow *data*-file growth specifically, enabling Instant File Initialization (the 'Perform volume maintenance tasks' right for the SQL service account) makes it near-instant; log files can't use IFI and always pay the full cost.",
    });
  }

  if (data.deadlocks && data.deadlocks.length > 0) {
    const latest = data.deadlocks[0];
    findings.push({
      severity: "info",
      panel: "Deadlocks",
      title: `${data.deadlocks.length} recent deadlock${data.deadlocks.length === 1 ? "" : "s"}`,
      detail: `Most recent at ${new Date(latest.timestamp).toLocaleTimeString()} — already resolved automatically by SQL Server, but worth reviewing if it keeps recurring.`,
      advice:
        "Nothing to do right now — SQL Server already picked a victim and rolled it back. If it recurs: the deadlock graph (Deadlocks tab) names the two queries and the objects they collided on. The usual fixes are making the app access tables in a consistent order, adding an index so one side holds its locks for less time, or having the app simply retry on error 1205 (a deadlock victim is safe to retry).",
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
