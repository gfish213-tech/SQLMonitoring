import type { DashboardTab, TriageData } from "../types";
import { diagnose } from "../diagnosis";

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
        {quickNote}
        {rest.length > 0 && (
          <details className="diagnosis-more">
            <summary>
              {rest.length} other potential factor{rest.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {rest.map((f, i) => {
                const tab = PANEL_TO_TAB[f.panel];
                return (
                  <li key={i}>
                    <strong>{f.panel}:</strong> {f.title} — {f.detail}
                    {tab && onJumpToPanel && (
                      <button className="diagnosis-jump" onClick={() => onJumpToPanel(tab)}>
                        View →
                      </button>
                    )}
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
