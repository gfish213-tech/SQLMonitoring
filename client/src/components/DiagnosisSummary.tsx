import type { DashboardTab, TriageData } from "../types";
import { diagnose, type Finding } from "../diagnosis";

const ICONS = { critical: "⛔", warning: "⚠", info: "ℹ" } as const;

// Maps a Finding's `panel` label (see diagnosis.ts) to the dashboard tab that shows it, so the
// banner can offer a direct "View details" jump. CPU/Memory pressure and TempDB findings all
// point at the Overview tab, where those panels live.
const PANEL_TO_TAB: Record<string, DashboardTab> = {
  Blocking: "blocking",
  "Long-running operation": "longops",
  "Agent job": "agentjobs",
  "CPU pressure": "overview",
  "Memory pressure": "overview",
  "Worker threads": "overview",
  "Plan cache": "overview",
  TempDB: "overview",
  "Transaction log": "logspace",
  "VLF count": "logspace",
  "Disk latency": "iolatency",
  "Disk space": "overview",
  Autogrowth: "autogrowth",
  Deadlocks: "deadlocks",
};

// Many findings of the same kind (every VLF-fragmented database, every hot IO file, every
// autogrowth event) carry the exact same "What to do" advice - findings of the same kind are
// already adjacent (diagnose() appends them from one panel's loop, and the later stable sort by
// severity preserves that relative order), so grouping consecutive identical-advice findings
// keeps every finding's own specifics visible while showing the shared advice box once instead
// of once per finding - the boxes are what dominated a long list, not the one-line summaries.
function groupByAdvice(findings: Finding[]): Finding[][] {
  const groups: Finding[][] = [];
  for (const f of findings) {
    const last = groups[groups.length - 1];
    if (last && last[0].advice === f.advice) last.push(f);
    else groups.push([f]);
  }
  return groups;
}

export function DiagnosisSummary({
  data,
  onJumpToPanel,
  isQuickOnly,
}: {
  data: TriageData;
  onJumpToPanel?: (tab: DashboardTab) => void;
  isQuickOnly?: boolean;
}) {
  const findings = diagnose(data);

  const quickNote = isQuickOnly && (
    <div className="diagnosis-quick-note">
      Based on a quick check only — Consumers, TempDB, VLF counts, IO Latency, Autogrowth, Deadlocks, Volume Space, and Index stats weren't
      checked this time. Click <strong>Full Refresh</strong> for the complete picture.
    </div>
  );

  if (findings.length === 0) {
    return (
      <div id="panel-diagnosis" className="diagnosis-banner diagnosis-clear">
        <span className="diagnosis-icon">✓</span>
        <div>
          <div className="diagnosis-title">No obvious cause detected</div>
          <div className="diagnosis-detail">
            Nothing crossed a concerning threshold in this snapshot. If the server still feels slow, check the panels below for anything
            more subtle.
          </div>
          {quickNote}
        </div>
      </div>
    );
  }

  const [top, ...rest] = findings;
  const topTab = PANEL_TO_TAB[top.panel];

  return (
    <div id="panel-diagnosis" className={`diagnosis-banner diagnosis-${top.severity}`}>
      <span className="diagnosis-icon">{ICONS[top.severity]}</span>
      <div>
        <div className="diagnosis-title">
          Most likely cause: {top.panel} — {top.title}
          {topTab && onJumpToPanel && (
            <button className="diagnosis-jump" onClick={() => onJumpToPanel(topTab)}>
              View details →
            </button>
          )}
        </div>
        <div className="diagnosis-detail">{top.detail}</div>
        <div className="diagnosis-advice">
          <span className="diagnosis-advice-label">💡 What to do:</span> {top.advice}
        </div>
        {quickNote}
        {rest.length > 0 && (
          <details className="diagnosis-more">
            <summary>
              {rest.length} other potential factor{rest.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {groupByAdvice(rest).map((group, i) => {
                const tab = PANEL_TO_TAB[group[0].panel];
                return (
                  <li key={i}>
                    {group.length === 1 ? (
                      <>
                        <strong>{group[0].panel}:</strong> {group[0].title} — {group[0].detail}
                        {tab && onJumpToPanel && (
                          <button className="diagnosis-jump" onClick={() => onJumpToPanel(tab)}>
                            View →
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <strong>
                          {group[0].panel} ({group.length} items):
                        </strong>
                        {tab && onJumpToPanel && (
                          <button className="diagnosis-jump" onClick={() => onJumpToPanel(tab)}>
                            View →
                          </button>
                        )}
                        {(() => {
                          // Some finding kinds (VLF count is the clean example) have a `detail`
                          // sentence that's pure boilerplate with no per-finding content at all -
                          // every item in the group has the literal same string. Showing that once
                          // instead of once per item removes real, verified-zero-information
                          // repetition; kinds where detail actually varies per item (disk latency's
                          // file path, autogrowth's duration/time) keep detail inline per item below,
                          // since collapsing there would lose real information.
                          const sameDetail = group.every((f) => f.detail === group[0].detail);
                          return (
                            <>
                              {sameDetail && <div className="diagnosis-group-note">{group[0].detail}</div>}
                              <ul className="diagnosis-group-items">
                                {group.map((f, j) => (
                                  <li key={j}>
                                    {f.title}
                                    {sameDetail ? "" : ` — ${f.detail}`}
                                  </li>
                                ))}
                              </ul>
                            </>
                          );
                        })()}
                      </>
                    )}
                    <div className="diagnosis-advice diagnosis-advice-inline">
                      <span className="diagnosis-advice-label">💡</span>{" "}
                      {group.length > 1 ? `Same for all ${group.length} items above: ` : ""}
                      {group[0].advice}
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
