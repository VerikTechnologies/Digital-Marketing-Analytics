import { useState, useEffect, useRef } from "react";
import { ScanLine, QrCode, Megaphone, Filter, Plus, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, BarChart, Bar, CartesianGrid,
} from "recharts";
import api from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { BeatLoader } from "react-spinners";
import LinkCard from "../components/LinkCard";

const COLORS = ["#3B82F6","#6366F1","#8B5CF6","#EC4899","#F59E0B","#10B981"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border shadow-sm p-2 rounded-md text-sm">
      <p className="font-semibold">{label}</p>
      <p className="text-primary">{payload[0].value} scans</p>
    </div>
  );
};

export const dashboardCache = {
  range: null,
  summary: null,
  timeseries: null,
  breakdown: null,
  qrs: null,
  timestamp: 0
};

export async function preloadDashboard() {
  try {
    const [s, t, b, q] = await Promise.all([
      api.get(`/api/analytics/summary?range=30`),
      api.get(`/api/analytics/timeseries?range=30`),
      api.get(`/api/analytics/breakdown?range=30`),
      api.get(`/api/qrs`),
    ]);
    dashboardCache.range = 30;
    dashboardCache.summary = s.data;
    dashboardCache.timeseries = t.data;
    dashboardCache.breakdown = b.data;
    dashboardCache.qrs = q.data;
    dashboardCache.timestamp = Date.now();
  } catch (e) { console.error("Preload error", e); }
}

export default function Dashboard({ setPage }) {
  const [summary,    setSummary]    = useState(dashboardCache.summary || {});
  const [timeseries, setTimeseries] = useState(dashboardCache.timeseries || []);
  const [breakdown,  setBreakdown]  = useState(dashboardCache.breakdown || {});
  const [qrs,        setQrs]        = useState(dashboardCache.qrs || []);
  const [range,      setRange]      = useState(dashboardCache.range || 30);
  const [loading,    setLoading]    = useState(!dashboardCache.summary);
  const [search,     setSearch]     = useState("");

  const abortRef = useRef(null);

  async function load() {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    
    // Only show loading spinner if we don't have cached data for this range
    if (dashboardCache.range !== range) {
      setLoading(true);
    }

    try {
      const [s, t, b, q] = await Promise.all([
        api.get(`/api/analytics/summary?range=${range}`, { signal: controller.signal }),
        api.get(`/api/analytics/timeseries?range=${range}`, { signal: controller.signal }),
        api.get(`/api/analytics/breakdown?range=${range}`, { signal: controller.signal }),
        api.get(`/api/qrs`, { signal: controller.signal }),
      ]);
      
      setSummary(s.data);
      setTimeseries(t.data);
      setBreakdown(b.data);
      setQrs(q.data);

      dashboardCache.range = range;
      dashboardCache.summary = s.data;
      dashboardCache.timeseries = t.data;
      dashboardCache.breakdown = b.data;
      dashboardCache.qrs = q.data;
      dashboardCache.timestamp = Date.now();
    } catch (err) {
      if (err.name !== "CanceledError" && err.code !== "ERR_CANCELED") console.error(err);
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }

  useEffect(() => { 
    // Always fetch in background to get fresh data, but cache prevents blank loading screen
    load(); 
  }, [range]);

  const filteredQrs = qrs.filter(q => 
    q.name.toLowerCase().includes(search.toLowerCase()) || 
    q.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto p-4 w-full">
      
      {/* Header & Loading */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-4xl font-extrabold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-4">
          {loading && <BeatLoader size={10} color="#3B82F6" />}
          <Button variant="outline" size="icon" onClick={() => { dashboardCache.range = null; load(); }} disabled={loading} title="Refresh Data">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Scans</CardTitle>
            <ScanLine className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.scans || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Scans Today</CardTitle>
            <ScanLine className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.today || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total QR Codes</CardTitle>
            <QrCode className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.qrs || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Megaphone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.campaigns || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Scan Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeseries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="scans" stroke="#3B82F6" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Top QR Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.top || []} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="code" tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Bar dataKey="scans" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {["browser", "os", "country"].map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="capitalize">{key}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {(breakdown[key] || []).slice(0, 6).map((item, i) => {
                  const max = breakdown[key][0]?.value || 1;
                  const pct = Math.round((item.value / max) * 100);
                  return (
                    <div key={item.label} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-muted-foreground">{item.label || "Unknown"}</span>
                        <span className="font-bold">{item.value}</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div 
                          className="h-2 rounded-full" 
                          style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} 
                        />
                      </div>
                    </div>
                  );
                })}
                {!(breakdown[key]?.length) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No data yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* QR Codes List */}
      <div className="flex flex-col gap-4 mt-4">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-extrabold tracking-tight">My Links</h2>
          <Button onClick={() => setPage('qrs')}>
            <Plus className="mr-2 h-4 w-4" /> Create Link
          </Button>
        </div>
        
        <div className="relative">
          <Input
            type="text"
            placeholder="Filter Links..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-12 text-lg"
          />
          <Filter className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-4 mt-2">
          {filteredQrs.map((qr) => (
            <LinkCard 
              key={qr.id} 
              qr={qr} 
              onUpdate={load} 
              onEditDest={() => setPage('qrs')}
              onHistory={() => setPage('qrs')}
            />
          ))}
          {filteredQrs.length === 0 && !loading && (
            <div className="text-center p-12 border rounded-lg bg-muted/20 border-dashed">
              <p className="text-muted-foreground">No QR codes found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
