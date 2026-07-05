export function StatCard({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  return (
    <div className={`stat-card ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
