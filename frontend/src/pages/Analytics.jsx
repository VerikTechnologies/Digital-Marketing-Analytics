import { useState, useEffect, useRef } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import api from "../api";

const PIE_COLORS = ["#3B82F6","#6366F1","#8B5CF6","#EC4899","#F59E0B","#10B981","#EF4444","#14B8A6"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label || payload[0]?.payload?.label}</p>
      <p className="chart-tooltip-value">{payload[0]?.value} scans</p>
    </div>
  );
};

function BreakdownPanel({ title, data, colors }) {
  if (!data?.length) return (
    <div className="panel">
      <h3 className="panel-title">{title}</h3>
      <p className="empty-state">No data yet.</p>
    </div>
  );
  const max = data[0]?.value || 1;
  return (
    <div className="panel">
      <h3 className="panel-title">{title}</h3>
      <div className="breakdown-list">
        {data.slice(0, 8).map((item, i) => (
          <div className="breakdown-row" key={item.label}>
            <span className="breakdown-label" title={item.label}>{item.label || "Unknown"}</span>
            <div className="breakdown-bar-wrap">
              <div
                className="breakdown-bar"
                style={{ width: `${Math.round((item.value / max) * 100)}%`, background: colors[i % colors.length] }}
              />
            </div>
            <b className="breakdown-value">{item.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export const analyticsCache = {
  range: null,
  summary: null,
  timeseries: null,
  breakdown: null,
  timestamp: 0
};

export async function preloadAnalytics() {
  try {
    const [s, t, b] = await Promise.all([
      api.get(`/api/analytics/summary?range=30`),
      api.get(`/api/analytics/timeseries?range=30`),
      api.get(`/api/analytics/breakdown?range=30`),
    ]);
    analyticsCache.range = 30;
    analyticsCache.summary = s.data;
    analyticsCache.timeseries = t.data;
    analyticsCache.breakdown = b.data;
    analyticsCache.timestamp = Date.now();
  } catch (e) { console.error("Preload error", e); }
}

export default function Analytics() {
  const [summary,    setSummary]    = useState(analyticsCache.summary || {});
  const [timeseries, setTimeseries] = useState(analyticsCache.timeseries || []);
  const [breakdown,  setBreakdown]  = useState(analyticsCache.breakdown || {});
  const [range,      setRange]      = useState(analyticsCache.range || 30);
  const [loading,    setLoading]    = useState(!analyticsCache.summary);

  const abortRef = useRef(null);

  async function load() {
    // Cancel any previous in-flight requests before starting new ones
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (analyticsCache.range !== range) {
      setLoading(true);
    }
    try {
      const [s, t, b] = await Promise.all([
        api.get(`/api/analytics/summary?range=${range}`,    { signal: controller.signal }),
        api.get(`/api/analytics/timeseries?range=${range}`, { signal: controller.signal }),
        api.get(`/api/analytics/breakdown?range=${range}`,  { signal: controller.signal }),
      ]);
      setSummary(s.data);
      setTimeseries(t.data);
      setBreakdown(b.data);

      analyticsCache.range = range;
      analyticsCache.summary = s.data;
      analyticsCache.timeseries = t.data;
      analyticsCache.breakdown = b.data;
      analyticsCache.timestamp = Date.now();
    } catch (err) {
      // Ignore aborted request errors
      if (err.name !== "CanceledError" && err.code !== "ERR_CANCELED") console.error(err);
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }

  useEffect(() => { load(); }, [range]);

  const deviceData = (breakdown.device || []).map((d) => ({
    name: d.label === "desktop" ? "Desktop" : d.label === "mobile" ? "Mobile" : d.label === "tablet" ? "Tablet" : d.label,
    value: d.value,
  }));

  return (
    <div className={`page-content${loading ? " page-content--loading" : ""}`}>
      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-filters">
          <button className="btn btn--secondary" onClick={() => { analyticsCache.range = null; load(); }} disabled={loading} title="Refresh Data">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} style={{ marginRight: 4 }} />
            Refresh
          </button>
          <button className="btn btn--secondary" onClick={() => window.open(`${import.meta.env.VITE_API_BASE || ""}/api/analytics/export?token=${localStorage.getItem("vqr_token") || ""}`, "_blank")} title="Export CSV">
            <Download size={16} style={{ marginRight: 4 }} />
            Export
          </button>
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              className={`filter-chip${range === d ? " active" : ""}`}
              onClick={() => setRange(d)}
            >
              {d === 365 ? "1 Year" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="analytics-kpi">
        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Total Scans</span>
          <strong className="analytics-kpi-value">{(summary.scans || 0).toLocaleString()}</strong>
        </div>
        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Today</span>
          <strong className="analytics-kpi-value">{summary.today || 0}</strong>
        </div>
        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Active QR Codes</span>
          <strong className="analytics-kpi-value">{summary.qrs || 0}</strong>
        </div>
        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Active Campaigns</span>
          <strong className="analytics-kpi-value">{summary.campaigns || 0}</strong>
        </div>
      </div>

      {/* Scan activity full-width chart */}
      <div className="panel panel--flex" style={{ marginBottom: 18 }}>
        <h3 className="panel-title">Scan Activity Over Time</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={timeseries} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="#E7EBF0" strokeDasharray="4 4" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8994A6" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#8994A6" }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Line dataKey="scans" stroke="#3B82F6" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Top QR codes + Device split */}
      <div className="charts-row" style={{ marginBottom: 18 }}>
        <div className="panel panel--flex">
          <h3 className="panel-title">Top QR Codes</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={summary.top || []} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#E7EBF0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="code" tick={{ fontSize: 10, fill: "#8994A6" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8994A6" }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="scans" fill="#6366F1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel panel--flex">
          <h3 className="panel-title">Device Type</h3>
          {deviceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={deviceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {deviceData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="empty-state">No data yet.</p>}
        </div>
      </div>

      {/* Breakdown grid */}
      <div className="breakdown-grid" style={{ marginBottom: 18 }}>
        <BreakdownPanel title="Browser" data={breakdown.browser} colors={PIE_COLORS} />
        <BreakdownPanel title="Operating System" data={breakdown.os} colors={PIE_COLORS} />
        <BreakdownPanel title="Destination Type" data={breakdown.destination} colors={PIE_COLORS} />
      </div>
      <div className="breakdown-grid">
        <BreakdownPanel title="Country" data={breakdown.country} colors={PIE_COLORS} />
        <BreakdownPanel title="City" data={breakdown.city} colors={PIE_COLORS} />
        <div className="panel">
          <h3 className="panel-title">Export</h3>
          <p className="text-muted" style={{ marginBottom: 14 }}>Download per-QR scan data as CSV from the QR Codes page using the download button on each row.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <Download size={16} style={{ color: "#6d7889" }} />
            <span style={{ fontSize: 13, color: "#6d7889" }}>Go to <strong>QR Codes</strong> → click <strong>Download</strong> on any QR row.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
