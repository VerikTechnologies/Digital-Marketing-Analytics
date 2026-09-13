export default function StatCard({ label, value, icon: Icon, color = "blue", trend }) {
  return (
    <div className={`stat-card stat-card--${color}`}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {Icon && (
          <div className="stat-card-icon">
            <Icon size={18} />
          </div>
        )}
      </div>
      <div className="stat-card-value">{value ?? 0}</div>
      {trend !== undefined && (
        <div className={`stat-card-trend ${trend >= 0 ? "up" : "down"}`}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}% vs yesterday
        </div>
      )}
    </div>
  );
}
