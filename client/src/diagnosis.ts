import type { TriageData } from "./types";
import { formatMs, truncate } from "./format";

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
        "Open the Consumers tab to find who's burning the CPU — one runaway query is far more common than genuine undersizing. Look for a session with CPU time far above the rest; its query text tells you whether to kill it, or whether it's a bad plan (a scan where a seek should be) worth fixing properly.",
    });
  }

  if (data.pressure.pageLifeExpectancy != null && data.pressure.pageLifeExpectancy < 300) {
    findings.push({
      severity: "warning",
      panel: "Memory pressure",
      title: `Low page life expectancy: ${data.pressure.pageLifeExpectancy}s`,
      detail: "Pages are being flushed from the buffer cache quickly, a common sign of memory pressure.",
      advice:
        "Check the Consumers tab for a session with huge logical reads — one big table scan can flush the whole cache. Also check the Plan Cache stats on the Overview tab: a bloated ad-hoc plan cache steals this same memory. If PLE is chronically low with no single culprit, the server genuinely needs more RAM (or a lower max server memory ceiling is set than intended).",
    });
  }

  if (data.pressure.pendingMemoryGrants > 0) {
    findings.push({
      severity: "warning",
      panel: "Memory pressure",
      title: `${data.pressure.pendingMemoryGrants} quer${data.pressure.pendingMemoryGrants === 1 ? "y is" : "ies are"} waiting on a memory grant`,
      detail: "Queries can't get the memory they need to start running — usually memory pressure or a runaway query elsewhere.",
      advice:
        "Open the Consumers tab and check the Memory Grant column — it flags exactly which session(s) are waiting and how much they're asking for. Usually one query holding an oversized grant starves the rest; killing or finishing that one typically releases the queue. Recurring cases are a bad plan or missing index on the greedy query.",
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
        "Same playbook as CPU pressure: find the top CPU burner in the Consumers tab. One query going parallel across every core (a bad plan doing a huge scan) can starve everything else; killing it or fixing its plan/index usually clears this immediately.",
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
    const currentValues = [io.currentReadLatencyMs, io.currentWriteLatencyMs].filter((v): v is number => v != null);
    const worstCurrent = currentValues.length > 0 ? Math.max(...currentValues) : null;
    const currentlyWorse = worstCurrent != null && worstCurrent > worstAvg;
    // A live 1-second sample that actually saw I/O (worstCurrent isn't null - there's no reading
    // to trust otherwise) and came back healthy, while the since-restart average is still what's
    // driving severity, means the average is very likely dragging on stale history from before
    // whatever caused it - the average has no way to reset except a SQL Server restart, so a
    // genuinely-fixed problem would otherwise keep reading as an active critical forever. Downgrade
    // instead of silently clearing it, since a single 1-second sample could still get lucky.
    const currentlyHealthy = worstCurrent != null && worstCurrent <= 15;
    const historicalOnly = !currentlyWorse && currentlyHealthy;
    const worst = currentlyWorse ? worstCurrent! : worstAvg;
    findings.push({
      severity: historicalOnly ? "info" : worst > 100 ? "critical" : "warning",
      panel: "Disk latency",
      title: `${io.databaseName}: ${worst.toFixed(0)}ms ${currentlyWorse ? "in the last ~1s" : "average"} I/O latency${
        historicalOnly ? " (currently healthy)" : ""
      }`,
      detail: `${io.fileName} — normal is under ~15ms; this can cause broad slowness for anything touching this file.${
        currentlyWorse
          ? " Worse right now than its since-restart average, so this is an active spike, not old history."
          : historicalOnly
            ? ` The last ~1s reading is healthy (${worstCurrent!.toFixed(1)}ms) — this may already be resolved; the average won't drop until the next SQL Server restart.`
            : ""
      }`,
      advice: historicalOnly
        ? "The live reading is healthy right now, so this probably isn't an active cause of the current slowness - the since-restart average just hasn't had a chance to recover (it never does without a restart). Worth a second look only if the server still feels slow with nothing else explaining it."
        : "First rule out that SQL Server is the one hammering the disk: is a backup running (Backups tab), an ETL job (Agent Jobs), or a huge scan (Consumers tab)? Also check the host for antivirus scanning database files (they should be excluded) and, on a VM/SAN, whether a neighbor or storage-side job is eating the shared array. If latency is high with *low* IOPS/throughput, the storage itself is slow — take the IOPS and MB/s figures from the IO Latency tab to your storage team.",
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

  if (data.queryStoreFailedDatabases && data.queryStoreFailedDatabases.length > 0) {
    const failures = data.queryStoreFailedDatabases;
    const n = failures.length;
    findings.push({
      severity: "warning",
      panel: "Query Store",
      title: `Query Store check failed on ${n} database${n === 1 ? "" : "s"}`,
      detail: `${failures.map((f) => `${f.database} (${f.error})`).join("; ")} — not fully checked this refresh, so a real regression there could be missing from this snapshot, not just absent.`,
      advice:
        "Open the Query Store tab to see the exact error per database. A timeout (a database with a large number of distinct queries tracked in Query Store) is one cause, but any SQL error would show up the same way here — read the error text first rather than assuming it's a timeout. Click ↻ Refresh Query Store to retry just this check.",
    });
  }

  for (const qs of data.queryStoreRegressions ?? []) {
    findings.push({
      severity: qs.regressionRatio >= 5 || qs.recentAvgDurationMs >= 5000 ? "critical" : "warning",
      panel: "Query Store",
      title: `A query on ${qs.databaseName} is running ${qs.regressionRatio.toFixed(1)}x slower than its own recent average`,
      detail: `Recent avg ${qs.recentAvgDurationMs.toFixed(0)}ms vs. prior avg ${qs.priorAvgDurationMs.toFixed(0)}ms, ${qs.executionCount} execution(s) in the latest interval.`,
      advice: `Open the Query Store tab to see the query text. Immediate mitigation: force the last-known-good plan with sp_query_store_force_plan (find a prior good plan_id via sys.query_store_plan for query_id ${qs.queryId} in SSMS's Query Store UI). Lasting fix: update statistics on the tables it touches, or add/rebuild whatever index the new plan is missing.`,
    });
  }

  if (data.errorLogError) {
    findings.push({
      severity: "warning",
      panel: "Error Log",
      title: "Error Log check failed",
      detail: `Not fully checked this refresh, so a real severity 16+ entry could be missing from this snapshot: ${data.errorLogError}`,
      advice: "Open the Error Log tab for the full error text, then click ↻ Refresh Error Log to retry.",
    });
  }

  if (data.errorLogEntries && data.errorLogEntries.length > 0) {
    const worst = data.errorLogEntries.reduce((a, b) => ((b.severity ?? 0) > (a.severity ?? 0) ? b : a));
    findings.push({
      severity: (worst.severity ?? 0) >= 20 ? "critical" : "warning",
      panel: "Error Log",
      title: `${data.errorLogEntries.length} severity 16+ error log entr${data.errorLogEntries.length === 1 ? "y" : "ies"} in the last 24 hours`,
      detail: `Worst: severity ${worst.severity ?? "-"} at ${new Date(worst.timestamp).toLocaleTimeString()} — ${truncate(worst.message, 160)}`,
      advice:
        (worst.severity ?? 0) >= 24
          ? "Severity 24-25 means a corruption error (823/824/825) — stop and run DBCC CHECKDB on the affected database immediately; don't take new backups over a known-good one until you know the extent of the damage. Open the Error Log tab for the full message."
          : "Open the Error Log tab for the full text of every entry. Severity 20+ is a fatal error to that connection/process (check for out-of-memory - 701/17803); severity 16-19 is a normal but real error worth understanding, not routine noise.",
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
