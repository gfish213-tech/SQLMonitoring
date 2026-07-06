export function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning";
  hint?: string;
}) {
  return (
    <div className={`stat-card ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">
        {label}
        {hint && (
          <span className="stat-hint" title={hint}>
            {" "}
            ⓘ
          </span>
        )}
      </div>
    </div>
  );
}
