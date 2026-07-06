import { Section } from "./Section";
import { formatMs, truncate } from "../format";
import type { LongOpRow } from "../types";

export function LongOpsPanel({ longOps }: { longOps: LongOpRow[] }) {
  return (
    <Section
      title="Backups & Long-Running Operations"
      isEmpty={longOps.length === 0}
      emptyText="No backup, restore, DBCC, or long-running operation in progress."
    >
      <div className="longop-list">
        {longOps.map((op) => (
          <div className="longop-row" key={op.sessionId}>
            <div className="longop-head">
              <span className="longop-command">{op.command}</span>
              <span>{op.databaseName ?? "-"}</span>
              <span>{op.loginName ?? "-"}</span>
              <span>Elapsed {formatMs(op.elapsedMs)}</span>
              {op.estimatedCompletionTime && <span>ETA {new Date(op.estimatedCompletionTime).toLocaleTimeString()}</span>}
            </div>
            {op.percentComplete !== null && (
              <div className="wait-bar-track">
                <div className="wait-bar-fill" style={{ width: `${Math.min(100, op.percentComplete)}%` }} />
              </div>
            )}
            <div className="longop-percent">{op.percentComplete !== null ? `${op.percentComplete.toFixed(1)}%` : ""}</div>
            {op.queryText && (
              <div className="blocker-detail">
                <code>{truncate(op.queryText, 140)}</code>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
