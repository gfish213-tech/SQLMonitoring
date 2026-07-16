import type { ConnectionMeta, TriageData } from "./types";
import { diagnose } from "./diagnosis";
import { formatMs, truncate } from "./format";

function field(label: string, value: string | number | null | undefined): string {
  return `${label}: ${value ?? "-"}`;
}

const NOT_CHECKED = "Not checked in this quick refresh - run Full Refresh for this section.";
// Index Stats is excluded from both Quick and Full Refresh (see dashboard.ts) - only its own
// tab's "Refresh Indexes" button populates it, so the generic NOT_CHECKED text above would be
// wrong here, not just imprecise.
const INDEX_STATS_NOT_CHECKED = "Not checked automatically - use the Indexes tab's own Refresh button for this section.";

// Query text and long lists (deadlock XML especially) can otherwise balloon this into thousands
// of lines once Consumers has no server-side row cap - the point of this text is diagnostic
// context for an AI, not a full data dump (the UI tables already show everything, uncapped).
const MAX_QUERY_CHARS = 200;
const MAX_CONSUMERS_SHOWN = 25;
const MAX_BLOCKED_SHOWN = 15;
const MAX_DEADLOCKS_SHOWN = 3;
const MAX_QUERY_STORE_SHOWN = 15;
const MAX_ERROR_LOG_SHOWN = 20;

// Plain-text rendering of the whole snapshot, meant to be pasted into an AI chat for further
// analysis - so every panel is spelled out in full sentences rather than relying on the visual
// layout (colors, borders, table alignment) that carries meaning on screen but not in plain text.
export function buildSummaryText(data: TriageData, connection: ConnectionMeta): string {
  const lines: string[] = [];

  lines.push(
    `# SQL Performance Snapshot — ${connection.label ?? connection.server}${connection.environment ? ` (${connection.environment})` : ""}`
  );
  lines.push(`Captured: ${new Date().toLocaleString()}`);
  lines.push(`Connection: ${connection.loginName} · ${connection.database} · ${connection.odbcDriver}`);
  lines.push("");

  const findings = diagnose(data);
  lines.push("## Diagnosis");
  if (findings.length === 0) {
    lines.push("No obvious cause detected - nothing crossed a concerning threshold in this snapshot.");
  } else {
    // Deliberately no "Suggested action" text here, unlike the on-screen advice boxes (see
    // DiagnosisSummary.tsx) - this text is meant to be pasted into an actual AI chat, which can
    // formulate its own recommendation from the raw facts below. Repeating this app's own canned
    // advice paragraph (verbatim, once per finding) wastes tokens on something the AI reading it
    // doesn't need - the facts (what's wrong, on what, since when) are the point of this section.
    const [top, ...rest] = findings;
    lines.push(`Most likely cause (${top.severity}): ${top.panel} — ${top.title}`);
    lines.push(top.detail);
    if (rest.length > 0) {
      lines.push("");
      lines.push("Other potential factors:");
      for (const f of rest) {
        lines.push(`- [${f.severity}] ${f.panel}: ${f.title} — ${f.detail}`);
      }
    }
  }
  lines.push("");

  lines.push("## Overview");
  lines.push(field("CPU Cores", data.overview.cpuCount));
  lines.push(field("Active Sessions", data.overview.activeSessionCount));
  lines.push(field("Active Requests", data.overview.activeRequestCount));
  lines.push(field("Blocked Requests", data.overview.blockedRequestCount));
  lines.push(field("Buffer Cache Hit Ratio", data.overview.bufferCacheHitRatio != null ? `${data.overview.bufferCacheHitRatio}%` : null));
  lines.push(field("Page Life Expectancy", data.overview.pageLifeExpectancy != null ? `${data.overview.pageLifeExpectancy}s` : null));
  lines.push(field("Batch Requests/sec", data.overview.batchRequestsPerSec));
  lines.push(field("Server Start Time", new Date(data.overview.sqlServerStartTime).toLocaleString()));
  lines.push(field("Plan Cache Size", `${data.overview.planCacheMb} MB`));
  lines.push(field("Ad-hoc Plans", data.overview.adhocPlanCachePercent != null ? `${data.overview.adhocPlanCachePercent}%` : null));
  lines.push(
    field(
      "Single-Use Ad-hoc Plans",
      `${data.overview.singleUseAdhocPlanCount} (${data.overview.singleUseAdhocPlanMb} MB)`
    )
  );
  lines.push("");

  lines.push("## Disk Volume Space");
  if (data.volumeSpace === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.volumeSpace.length === 0) {
    lines.push("No volume information available.");
  } else {
    for (const v of data.volumeSpace) {
      lines.push(`- ${v.volumeMountPoint}${v.logicalVolumeName ? ` (${v.logicalVolumeName})` : ""}: ${v.freeGb} GB free of ${v.totalGb} GB (${v.freePercent}% free)`);
    }
  }
  lines.push("");

  lines.push("## Blocking & Long Transactions");
  if (data.blocking.length === 0) {
    lines.push("No blocking detected.");
  } else {
    for (const b of data.blocking) {
      lines.push(
        `- Session ${b.sessionId} (${b.loginName ?? "-"} on ${b.hostName ?? "-"}) ${
          b.isIdleWithOpenTransaction ? "idle with an open transaction" : `status=${b.status}`
        }, blocking ${b.blockedSessions.length} session(s), DB=${b.databaseName ?? "-"}`
      );
      if (b.lastStatementText) lines.push(`  Last statement: ${truncate(b.lastStatementText, MAX_QUERY_CHARS)}`);
      const waiters = b.blockedSessions.slice(0, MAX_BLOCKED_SHOWN);
      for (const w of waiters) {
        lines.push(
          `  - Session ${w.sessionId} (${w.loginName ?? "-"}) waiting on session ${w.blockedBy}, on ${w.databaseName ?? "-"} — ${
            w.waitType ?? "-"
          } for ${formatMs(w.waitTimeMs)} — query: ${w.queryText ? truncate(w.queryText, MAX_QUERY_CHARS) : "-"}`
        );
      }
      if (b.blockedSessions.length > waiters.length) {
        lines.push(`  ... and ${b.blockedSessions.length - waiters.length} more blocked session(s) not shown - see the Blocking tab.`);
      }
    }
  }
  lines.push("");

  lines.push("## Backups & Long-Running Operations");
  if (data.longOps.length === 0) {
    lines.push("None in progress.");
  } else {
    for (const op of data.longOps) {
      lines.push(
        `- ${op.command} on ${op.databaseName ?? "-"}${op.percentComplete != null ? ` (${op.percentComplete.toFixed(1)}% complete)` : ""}, elapsed ${formatMs(
          op.elapsedMs
        )}, started by ${op.loginName ?? "-"}${op.queryText ? ` — ${truncate(op.queryText, MAX_QUERY_CHARS)}` : ""}`
      );
    }
  }
  lines.push("");

  lines.push("## Running Agent Jobs (currently executing only, not scheduled or failed jobs)");
  if (data.agentJobs.length === 0) {
    lines.push("None running.");
  } else {
    for (const j of data.agentJobs) {
      lines.push(
        `- ${j.jobName} — started ${new Date(j.startTime).toLocaleString()}, session ${j.sessionId ?? "-"}, CPU ${
          j.cpuTimeMs != null ? formatMs(j.cpuTimeMs) : "-"
        }, wait=${j.waitType ?? "-"}`
      );
    }
  }
  lines.push("");

  lines.push("## Top Resource Consumers (Right Now) (top sessions by CPU, disk IO, or memory)");
  if (data.consumers.length === 0) {
    lines.push("No active requests other than this connection.");
  } else {
    const shown = data.consumers.slice(0, MAX_CONSUMERS_SHOWN);
    for (const c of shown) {
      const memGrant =
        c.memoryGrantMb !== null ? `, memory grant=${c.memoryGrantMb} MB${c.memoryGrantPending ? " (waiting)" : ""}` : "";
      lines.push(
        `- Session ${c.sessionId} (${c.loginName}) on ${c.databaseName ?? "-"} — ${c.command ?? "-"}, CPU ${formatMs(
          c.cpuTimeMs
        )}, elapsed ${formatMs(c.elapsedMs)}, logical reads=${c.logicalReads}, physical reads=${c.physicalReads}, writes=${
          c.writes
        }${memGrant}, wait=${c.waitType ?? "-"}${c.blockingSessionId ? `, blocked by ${c.blockingSessionId}` : ""}${
          c.queryText ? ` — ${truncate(c.queryText, MAX_QUERY_CHARS)}` : ""
        }`
      );
    }
    if (data.consumers.length > shown.length) {
      lines.push(
        `... and ${data.consumers.length - shown.length} more session(s) not shown here (sorted by CPU) - see the Consumers tab for the full, sortable list.`
      );
    }
  }
  lines.push("");

  lines.push("## Current Waits (excludes benign background waits; one row per session+wait type)");
  if (data.waits.length === 0) {
    lines.push("No notable waits.");
  } else {
    for (const w of data.waits) {
      const tasks = w.taskCount > 1 ? ` across ${w.taskCount} parallel tasks` : "";
      lines.push(`- Session ${w.sessionId} on ${w.databaseName ?? "-"} — ${w.waitType} for ${formatMs(w.waitDurationMs)}${tasks} (${w.resourceDescription ?? "-"})`);
    }
  }
  lines.push("");

  lines.push("## CPU & Memory Pressure");
  lines.push(field("Signal Wait % (CPU pressure)", data.pressure.signalWaitPercent != null ? `${data.pressure.signalWaitPercent}%` : null));
  lines.push(field("Page Life Expectancy", data.pressure.pageLifeExpectancy != null ? `${data.pressure.pageLifeExpectancy}s` : null));
  lines.push(field("Buffer Cache Hit Ratio", data.pressure.bufferCacheHitRatio != null ? `${data.pressure.bufferCacheHitRatio}%` : null));
  lines.push(field("Pending Memory Grants", data.pressure.pendingMemoryGrants));
  lines.push(field("Runnable Tasks", data.pressure.runnableTasksCount));
  lines.push(field("Worker Queue", data.pressure.workQueueCount));
  lines.push("");

  lines.push("## TempDB Contention");
  if (data.tempdb === undefined) {
    lines.push(NOT_CHECKED);
  } else {
    lines.push(field("Total Size", `${data.tempdb.totalDataFileMb} MB`));
    lines.push(field("Used", `${data.tempdb.usedMb} MB`));
    lines.push(field("Free", `${data.tempdb.freeMb} MB`));
    lines.push(field("User Objects", `${data.tempdb.userObjectsMb} MB`));
    lines.push(field("Internal Objects", `${data.tempdb.internalObjectsMb} MB`));
    lines.push(field("Version Store", `${data.tempdb.versionStoreMb} MB`));
    if (data.tempdb.topAllocators.length > 0) {
      lines.push("Top allocators:");
      for (const a of data.tempdb.topAllocators) {
        lines.push(`- Session ${a.sessionId} (${a.loginName ?? "-"}) — ${a.tempdbAllocatedMb} MB`);
      }
    }
  }
  lines.push("");

  lines.push("## Transaction Log Space (only databases over 50% log used are shown)");
  if (data.logSpace.length === 0) {
    lines.push("No database over 50% log used.");
  } else {
    for (const l of data.logSpace) {
      lines.push(`- ${l.databaseName}: ${l.logUsedPercent}% used of ${l.logSizeMb} MB`);
    }
  }
  lines.push("");

  lines.push("## Virtual Log File (VLF) Counts (only databases over 100 VLFs shown; requires SQL Server 2017+)");
  if (data.vlfCounts === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.vlfCounts.length === 0) {
    lines.push("No database has an excessive VLF count.");
  } else {
    for (const v of data.vlfCounts) {
      lines.push(`- ${v.databaseName}: ${v.vlfCount} VLFs`);
    }
  }
  lines.push("");

  lines.push("## Disk / IO Latency (flagged if either the since-restart average or the last ~1s is elevated)");
  if (data.ioLatency === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.ioLatency.length === 0) {
    lines.push("No file with elevated latency.");
  } else {
    for (const io of data.ioLatency) {
      lines.push(
        `- ${io.databaseName} (${io.fileName}) — since-restart avg: read ${io.avgReadLatencyMs ?? "-"}ms/write ${io.avgWriteLatencyMs ?? "-"}ms; ` +
          `last ~1s: read ${io.currentReadLatencyMs ?? "-"}ms/write ${io.currentWriteLatencyMs ?? "-"}ms, ` +
          `${io.readIops ?? "-"}/${io.writeIops ?? "-"} read/write IOPS, ${io.readThroughputMBps ?? "-"}/${io.writeThroughputMBps ?? "-"} MB/s read/write`
      );
    }
  }
  lines.push("");

  lines.push("## Recent Auto-Growth Events (last 24 hours)");
  if (data.autogrowth === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.autogrowth.length === 0) {
    lines.push("None in the last 24 hours.");
  } else {
    for (const ev of data.autogrowth) {
      lines.push(
        `- ${ev.databaseName ?? "-"} ${ev.eventType} file grew at ${new Date(ev.startTime).toLocaleString()}, took ${formatMs(ev.durationMs)} (${
          ev.fileName ?? "-"
        })`
      );
    }
  }
  lines.push("");

  lines.push("## Recent Deadlocks (from system_health; already resolved automatically by SQL Server)");
  if (data.deadlocks === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.deadlocks.length === 0) {
    lines.push("None found in system_health.");
  } else {
    const shown = data.deadlocks.slice(0, MAX_DEADLOCKS_SHOWN);
    for (const d of shown) {
      lines.push(`- ${new Date(d.timestamp).toLocaleString()}:`);
      lines.push("```xml");
      lines.push(d.xml);
      lines.push("```");
    }
    if (data.deadlocks.length > shown.length) {
      lines.push(`... and ${data.deadlocks.length - shown.length} more deadlock(s) not shown here - see the Deadlocks tab for the full graphs.`);
    }
  }
  lines.push("");

  lines.push("## Query Store Regressions (queries ≥3x slower than their own recent average; last 24h; Query Store-enabled databases only)");
  if (data.queryStoreRegressions === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.queryStoreRegressions.length === 0) {
    lines.push("No regressed queries found in any Query Store-enabled database.");
  } else {
    const shown = data.queryStoreRegressions.slice(0, MAX_QUERY_STORE_SHOWN);
    for (const qs of shown) {
      lines.push(
        `- ${qs.databaseName} (query_id ${qs.queryId}): ${qs.regressionRatio.toFixed(1)}x slower — recent avg ${qs.recentAvgDurationMs.toFixed(
          0
        )}ms vs. prior avg ${qs.priorAvgDurationMs.toFixed(0)}ms, ${qs.executionCount} execution(s) — ${truncate(qs.queryText, MAX_QUERY_CHARS)}`
      );
    }
    if (data.queryStoreRegressions.length > shown.length) {
      lines.push(`... and ${data.queryStoreRegressions.length - shown.length} more not shown here - see the Query Store tab.`);
    }
  }
  lines.push("");

  lines.push("## Error Log (severity 16+ only; last 24 hours; current log file)");
  if (data.errorLogEntries === undefined) {
    lines.push(NOT_CHECKED);
  } else if (data.errorLogEntries.length === 0) {
    lines.push("No severity 16+ entries in the last 24 hours.");
  } else {
    const shown = data.errorLogEntries.slice(0, MAX_ERROR_LOG_SHOWN);
    for (const e of shown) {
      lines.push(`- ${new Date(e.timestamp).toLocaleString()} (severity ${e.severity ?? "-"}): ${truncate(e.message, MAX_QUERY_CHARS)}`);
    }
    if (data.errorLogEntries.length > shown.length) {
      lines.push(`... and ${data.errorLogEntries.length - shown.length} more not shown here - see the Error Log tab.`);
    }
  }
  lines.push("");

  lines.push("## Top Tables by Scans (since last restart; index_id shown instead of index name)");
  if (data.indexStats === undefined) {
    lines.push(INDEX_STATS_NOT_CHECKED);
  } else if (data.indexStats.topScannedTables.length === 0) {
    lines.push("No table has significant scan activity.");
  } else {
    for (const t of data.indexStats.topScannedTables) {
      lines.push(`- ${t.databaseName}.${t.tableName}: ${t.totalScans} scans, ${t.totalSeeks} seeks, ${t.totalLookups} lookups`);
    }
  }
  lines.push("");

  lines.push("## Unused Indexes (since last restart; written to but never read)");
  if (data.indexStats === undefined) {
    lines.push(INDEX_STATS_NOT_CHECKED);
  } else if (data.indexStats.unusedIndexes.length === 0) {
    lines.push("No index has write activity with zero reads.");
  } else {
    for (const idx of data.indexStats.unusedIndexes) {
      lines.push(`- ${idx.databaseName}.${idx.tableName} (index_id ${idx.indexId}): ${idx.totalWrites} writes, 0 reads`);
    }
  }

  return lines.join("\n");
}
