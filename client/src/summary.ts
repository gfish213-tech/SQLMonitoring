import type { ConnectionMeta, TriageData } from "./types";
import { diagnose } from "./diagnosis";
import { formatMs } from "./format";

function field(label: string, value: string | number | null | undefined): string {
  return `${label}: ${value ?? "-"}`;
}

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
  lines.push("");

  lines.push("## Disk Volume Space");
  if (data.volumeSpace.length === 0) {
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
      if (b.lastStatementText) lines.push(`  Last statement: ${b.lastStatementText}`);
      for (const w of b.blockedSessions) {
        lines.push(
          `  - Session ${w.sessionId} (${w.loginName ?? "-"}) waiting on session ${w.blockedBy}, on ${w.databaseName ?? "-"} — ${
            w.waitType ?? "-"
          } for ${formatMs(w.waitTimeMs)} — query: ${w.queryText ?? "-"}`
        );
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
        )}, started by ${op.loginName ?? "-"}${op.queryText ? ` — ${op.queryText}` : ""}`
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

  lines.push("## Top Resource Consumers (Right Now) (top 20 by CPU time)");
  if (data.consumers.length === 0) {
    lines.push("No active requests other than this connection.");
  } else {
    for (const c of data.consumers) {
      lines.push(
        `- Session ${c.sessionId} (${c.loginName}) on ${c.databaseName ?? "-"} — ${c.command ?? "-"}, CPU ${formatMs(
          c.cpuTimeMs
        )}, elapsed ${formatMs(c.elapsedMs)}, reads=${c.logicalReads}, writes=${c.writes}, wait=${c.waitType ?? "-"}${
          c.blockingSessionId ? `, blocked by ${c.blockingSessionId}` : ""
        }${c.queryText ? ` — ${c.queryText}` : ""}`
      );
    }
  }
  lines.push("");

  lines.push("## Current Waits (excludes benign background waits)");
  if (data.waits.length === 0) {
    lines.push("No notable waits.");
  } else {
    for (const w of data.waits) {
      lines.push(`- Session ${w.sessionId} on ${w.databaseName ?? "-"} — ${w.waitType} for ${formatMs(w.waitDurationMs)} (${w.resourceDescription ?? "-"})`);
    }
  }
  lines.push("");

  lines.push("## CPU & Memory Pressure");
  lines.push(field("Signal Wait % (CPU pressure)", data.pressure.signalWaitPercent != null ? `${data.pressure.signalWaitPercent}%` : null));
  lines.push(field("Page Life Expectancy", data.pressure.pageLifeExpectancy != null ? `${data.pressure.pageLifeExpectancy}s` : null));
  lines.push(field("Buffer Cache Hit Ratio", data.pressure.bufferCacheHitRatio != null ? `${data.pressure.bufferCacheHitRatio}%` : null));
  lines.push(field("Pending Memory Grants", data.pressure.pendingMemoryGrants));
  lines.push("");

  lines.push("## TempDB Contention");
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

  lines.push("## Disk / IO Latency (flagged if either the since-restart average or the last ~1s is elevated)");
  if (data.ioLatency.length === 0) {
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
  if (data.autogrowth.length === 0) {
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
  if (data.deadlocks.length === 0) {
    lines.push("None found in system_health.");
  } else {
    for (const d of data.deadlocks) {
      lines.push(`- ${new Date(d.timestamp).toLocaleString()}:`);
      lines.push("```xml");
      lines.push(d.xml);
      lines.push("```");
    }
  }

  return lines.join("\n");
}
