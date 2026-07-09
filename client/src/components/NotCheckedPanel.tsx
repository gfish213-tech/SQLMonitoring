import type { ReactNode } from "react";

// Shown in place of a full-only panel before a Full Refresh has run. Deliberately distinct
// wording from a normal empty state ("no blocking detected") - this data was never fetched at
// all, so it must not read as "checked and clean." `hint` overrides the default "click Full
// Refresh" wording for a panel Full Refresh never populates (Indexes - see dashboard.ts), where
// that default would be actively wrong instead of just generic.
export function NotCheckedPanel({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <section className="panel panel-not-checked">
      <div className="panel-header">
        <h2>{label}</h2>
      </div>
      <div className="empty-panel">
        {hint ?? (
          <>
            Not checked in this quick refresh — click <strong>Full Refresh</strong> to check this.
          </>
        )}
      </div>
    </section>
  );
}
