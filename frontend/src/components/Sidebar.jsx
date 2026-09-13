import { QrCode, LayoutDashboard, Building2, Megaphone, BarChart3, LogOut } from "lucide-react";

const NAV = [
  ["dashboard",  "Dashboard",  LayoutDashboard],
  ["brands",     "Brands",     Building2],
  ["campaigns",  "Campaigns",  Megaphone],
  ["qrs",        "QR Codes",   QrCode],
  ["analytics",  "Analytics",  BarChart3],
];

export default function Sidebar({ page, setPage, onSignOut }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <QrCode size={22} />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">VERIK QR</span>
          <span className="sidebar-brand-sub">Campaign Manager</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(([id, label, Icon]) => (
          <button
            key={id}
            className={`nav-item${page === id ? " active" : ""}`}
            onClick={() => setPage(id)}
            title={label}
          >
            <Icon size={18} />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <button className="nav-item signout" onClick={onSignOut} title="Sign out">
        <LogOut size={18} />
        <span className="nav-label">Sign out</span>
      </button>
    </aside>
  );
}
