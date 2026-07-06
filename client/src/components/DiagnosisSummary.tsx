import type { TriageData } from "../types";
import { diagnose } from "../diagnosis";

const ICONS = { critical: "⛔", warning: "⚠", info: "ℹ" } as const;

export function DiagnosisSummary({ data }: { data: TriageData }) {
  const findings = diagnose(data);

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
        </div>
      </div>
    );
  }

  const [top, ...rest] = findings;

  return (
    <div id="panel-diagnosis" className={`diagnosis-banner diagnosis-${top.severity}`}>
      <span className="diagnosis-icon">{ICONS[top.severity]}</span>
      <div>
        <div className="diagnosis-title">
          Most likely cause: {top.panel} — {top.title}
        </div>
        <div className="diagnosis-detail">{top.detail}</div>
        {rest.length > 0 && (
          <details className="diagnosis-more">
            <summary>
              {rest.length} other potential factor{rest.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {rest.map((f, i) => (
                <li key={i}>
                  <strong>{f.panel}:</strong> {f.title} — {f.detail}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
