import { User, Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

const PAGE_TITLES = {
  dashboard: { title: "Dashboard", sub: "Overview of all brands, campaigns, and QR activity." },
  brands:    { title: "Brands",    sub: "Manage top-level business brands." },
  campaigns: { title: "Campaigns", sub: "Marketing initiatives linked to brands." },
  qrs:       { title: "QR Codes",  sub: "Permanent codes — edit destinations without reprinting." },
  analytics: { title: "Analytics", sub: "Scan data, trends, and breakdowns." },
};

export default function Header({ page, user }) {
  const { theme, setTheme } = useTheme();
  const info = PAGE_TITLES[page] || PAGE_TITLES.dashboard;
  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">{info.title}</h1>
        <p className="topbar-sub">{info.sub}</p>
      </div>
      <div className="topbar-right" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button 
          className="btn btn--secondary" 
          style={{ padding: '8px', borderRadius: '50%', width: '34px', height: '34px', display: 'grid', placeItems: 'center' }}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="user-chip">
          <div className="user-avatar">
            <User size={14} />
          </div>
          <span className="user-name">{user?.username}</span>
        </div>
      </div>
    </header>
  );
}
