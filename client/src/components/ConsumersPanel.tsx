import { useMemo, useState } from "react";
import { Section } from "./Section";
import { formatMs, truncate } from "../format";
import { describeWaitType } from "../waitTypes";
import type { ConsumerRow } from "../types";

type SortKey = "cpuTimeMs" | "elapsedMs" | "logicalReads" | "physicalReads" | "writes" | "tempdbMb" | "memoryGrantMb";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "cpuTimeMs", label: "CPU" },
  { key: "elapsedMs", label: "Elapsed" },
  { key: "logicalReads", label: "Logical Reads" },
  { key: "physicalReads", label: "Physical Reads" },
  { key: "writes", label: "Writes" },
  { key: "tempdbMb", label: "TempDB" },
  { key: "memoryGrantMb", label: "Memory Grant" },
];

// The full row set is already fetched in one shot (see consumers.ts - no server-side cap), so
// re-sorting by a different resource is free: no new query, just re-ordering what's already in
// the browser, and no risk of a real top consumer being missing because it didn't make some
// server-side "top N" cut. Nulls (e.g. no memory grant, no TempDB usage) always sort last
// regardless of direction, so "who's using the most X" never buries real numbers under dashes.
function sortConsumers(consumers: ConsumerRow[], key: SortKey, dir: "asc" | "desc"): ConsumerRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...consumers].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * sign;
  });
}

export function ConsumersPanel({ consumers }: { consumers: ConsumerRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "cpuTimeMs", dir: "desc" });
  // Defaults on: "sa" is almost always a maintenance/monitoring login, not the cause of a
  // slowdown, and it tends to crowd out the sessions actually worth looking at. Still a toggle,
  // not a hard filter, since an actual incident caused by something running as sa is possible.
  const [hideSa, setHideSa] = useState(true);

  const filtered = useMemo(
    () => (hideSa ? consumers.filter((c) => c.loginName.toLowerCase() !== "sa") : consumers),
    [consumers, hideSa]
  );
  const sorted = useMemo(() => sortConsumers(filtered, sort.key, sort.dir), [filtered, sort]);
  const hiddenCount = consumers.length - filtered.length;

  function handleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  function headerFor(key: SortKey, label: string) {
    const active = sort.key === key;
    return (
      <th key={key} className="sortable-th num" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort-button" onClick={() => handleSort(key)}>
          {label}
          <span className={`sort-arrow ${active ? "active" : ""}`}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  }

  return (
    <Section
      id="panel-consumers"
      title="Top Resource Consumers (Right Now)"
      badge={
        <span className="panel-badge-row">
          <span className="panel-hint">
            every currently active request — click a column to sort, hover a wait type for what it means
          </span>
          <label className="panel-filter-toggle">
            <input type="checkbox" checked={hideSa} onChange={(e) => setHideSa(e.target.checked)} />
            Hide "sa" session{hideSa && hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
          </label>
        </span>
      }
      isEmpty={sorted.length === 0}
      emptyText={
        consumers.length > 0 && sorted.length === 0
          ? "No active requests left after hiding \"sa\" sessions — uncheck the filter above to see them."
          : "No active requests consuming significant resources right now."
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Session</th>
              <th>Login</th>
              <th>Host / App</th>
              <th>DB</th>
              {SORT_COLUMNS.map((c) => headerFor(c.key, c.label))}
              <th>Wait</th>
              <th className="num">Blocked By</th>
              <th>Query</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.sessionId} className={c.blockingSessionId ? "blocked-row" : ""}>
                <td className="num">{c.sessionId}</td>
                <td>{c.loginName}</td>
                <td>
                  {c.hostName ?? "-"} / {c.programName ?? "-"}
                </td>
                <td>{c.databaseName ?? "-"}</td>
                <td className="num">{formatMs(c.cpuTimeMs)}</td>
                <td className="num">{formatMs(c.elapsedMs)}</td>
                <td className="num">{c.logicalReads.toLocaleString()}</td>
                <td className="num">{c.physicalReads.toLocaleString()}</td>
                <td className="num">{c.writes.toLocaleString()}</td>
                <td className="num">{c.tempdbMb !== null && c.tempdbMb > 0 ? `${c.tempdbMb} MB` : "-"}</td>
                <td className="num">
                  {c.memoryGrantMb !== null ? (
                    c.memoryGrantPending ? (
                      <span className="mem-grant-pending">waiting for {c.memoryGrantMb} MB</span>
                    ) : (
                      `${c.memoryGrantMb} MB`
                    )
                  ) : (
                    "-"
                  )}
                </td>
                <td className="wait-type-cell" title={describeWaitType(c.waitType) ?? undefined}>
                  {c.waitType ?? "-"}
                </td>
                <td className="num">{c.blockingSessionId ?? "-"}</td>
                <td className="query-cell">
                  <code>{c.queryText ? truncate(c.queryText, 100) : "-"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
