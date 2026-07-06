// Shown in place of a full-only panel before a Full Refresh has run. Deliberately distinct
// wording from a normal empty state ("no blocking detected") - this data was never fetched at
// all, so it must not read as "checked and clean."
export function NotCheckedPanel({ label }: { label: string }) {
  return (
    <section className="panel panel-not-checked">
      <div className="panel-header">
        <h2>{label}</h2>
      </div>
      <div className="empty-panel">
        Not checked in this quick refresh — click <strong>Full Refresh</strong> to check this.
      </div>
    </section>
  );
}
