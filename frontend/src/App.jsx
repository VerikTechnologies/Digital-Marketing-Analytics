import { useState, useEffect } from "react";
import Sidebar  from "./components/Sidebar";
import Header   from "./components/Header";
import Login    from "./pages/Login";
import Dashboard, { preloadDashboard } from "./pages/Dashboard";
import Brands, { preloadBrands } from "./pages/Brands";
import Campaigns, { preloadCampaigns } from "./pages/Campaigns";
import QRCodes, { preloadQRCodes } from "./pages/QRCodes";
import Analytics, { preloadAnalytics } from "./pages/Analytics";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import api from "./api";

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("vqr_token");
    if (token) {
      api.get("/api/auth/me")
        .then((r) => {
          setUser(r.data.user);
          prefetchAll();
        })
        .catch(() => localStorage.removeItem("vqr_token"))
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  function handleSignOut() {
    localStorage.removeItem("vqr_token");
    setUser(null);
    setPage("dashboard");
  }

  if (checking) {
    return (
      <div className="splash">
        <div className="splash-spinner" />
      </div>
    );
  }

  function prefetchAll() {
    preloadDashboard();
    preloadBrands();
    preloadCampaigns();
    preloadQRCodes();
    preloadAnalytics();
  }

  function handleLogin(userData) {
    setUser(userData);
    prefetchAll();
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  const PAGE_MAP = {
    dashboard: <Dashboard setPage={setPage} />,
    brands:    <Brands />,
    campaigns: <Campaigns />,
    qrs:       <QRCodes />,
    analytics: <Analytics />,
  };

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} onSignOut={handleSignOut} />
      <div className="app-main">
        <Header page={page} user={user} />
        <main className="app-content">
          {PAGE_MAP[page] || <Dashboard />}
        </main>
      </div>
      <VercelAnalytics />
    </div>
  );
}
