import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import Modal from "../components/Modal";
import StatusPill from "../components/StatusPill";
import api from "../api";

const TYPES   = ["Offline", "Online", "Social", "Event", "Email", "OOH", "Mixed"];
const STATUSES = ["draft", "active", "paused", "completed", "archived"];
const EMPTY = { brand_id: "", name: "", campaign_type: "Offline", start_date: "", end_date: "", budget: "", status: "active", notes: "" };

export const campaignsCache = { rows: null, brands: null };

export async function preloadCampaigns() {
  try {
    const [c, b] = await Promise.all([api.get("/api/campaigns"), api.get("/api/brands")]);
    campaignsCache.rows = c.data;
    campaignsCache.brands = b.data;
  } catch (e) { console.error("Preload error", e); }
}

export default function Campaigns() {
  const [rows,    setRows]    = useState(campaignsCache.rows || []);
  const [brands,  setBrands]  = useState(campaignsCache.brands || []);
  const [open,    setOpen]    = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [filter,  setFilter]  = useState("all");

  async function load() {
    const [c, b] = await Promise.all([api.get("/api/campaigns"), api.get("/api/brands")]);
    setRows(c.data);
    setBrands(b.data);
    campaignsCache.rows = c.data;
    campaignsCache.brands = b.data;
  }
  useEffect(() => { load(); }, []);

  function openCreate() { setEditing(null); setForm(EMPTY); setError(""); setOpen(true); }
  function openEdit(r)  { setEditing(r); setForm({ brand_id: r.brand_id, name: r.name, campaign_type: r.campaign_type, start_date: r.start_date?.slice(0,10)||"", end_date: r.end_date?.slice(0,10)||"", budget: r.budget||"", status: r.status, notes: r.notes||"" }); setError(""); setOpen(true); }
  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      const payload = { ...form, budget: form.budget ? Number(form.budget) : null };
      if (editing) await api.put(`/api/campaigns/${editing.id}`, payload);
      else          await api.post("/api/campaigns", payload);
      setOpen(false); load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save campaign.");
    } finally { setSaving(false); }
  }

  async function handleDelete(r) {
    if (!confirm(`Delete campaign "${r.name}"? This cannot be undone.`)) return;
    await api.delete(`/api/campaigns/${r.id}`); load();
  }

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="page-content">
      <div className="toolbar">
        <div className="toolbar-filters">
          <button className="btn btn--secondary" onClick={() => { campaignsCache.rows = null; load(); }} title="Refresh Data">
            <RefreshCw size={16} style={{ marginRight: 4 }} />
            Refresh
          </button>
          {["all", ...STATUSES].map((s) => (
            <button
              key={s}
              className={`filter-chip${filter === s ? " active" : ""}`}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? `All (${rows.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${rows.filter(r=>r.status===s).length})`}
            </button>
          ))}
        </div>
        <button id="add-campaign-btn" className="btn btn--primary" onClick={openCreate}>
          <Plus size={16} /> New Campaign
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Brand</th>
              <th>Type</th>
              <th>Dates</th>
              <th>QRs</th>
              <th>Scans</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <small>{r.slug}</small>
                </td>
                <td>{r.brand_name}</td>
                <td>{r.campaign_type || "—"}</td>
                <td>
                  {r.start_date ? (
                    <small>{r.start_date?.slice(0,10)}{r.end_date ? ` → ${r.end_date?.slice(0,10)}` : ""}</small>
                  ) : <span className="text-muted">—</span>}
                </td>
                <td>{r.qrs}</td>
                <td>{r.scans}</td>
                <td><StatusPill status={r.status} /></td>
                <td>
                  <div className="row-actions">
                    <button className="btn-icon" title="Edit" onClick={() => openEdit(r)}><Pencil size={14} /></button>
                    <button className="btn-icon btn-icon--danger" title="Delete" onClick={() => handleDelete(r)}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No campaigns found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title={editing ? "Edit Campaign" : "New Campaign"} onClose={() => setOpen(false)} wide>
          <form id="campaign-form" onSubmit={handleSubmit} className="form">
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="camp-brand">Brand *</label>
                <select id="camp-brand" className="field-input" required value={form.brand_id} onChange={set("brand_id")}>
                  <option value="">Select brand…</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="camp-type">Campaign Type</label>
                <select id="camp-type" className="field-input" value={form.campaign_type} onChange={set("campaign_type")}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="camp-name">Campaign Name *</label>
              <input id="camp-name" className="field-input" required value={form.name} onChange={set("name")} placeholder="e.g. Ganesh Festival 2026" />
            </div>

            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="camp-start">Start Date</label>
                <input id="camp-start" type="date" className="field-input" value={form.start_date} onChange={set("start_date")} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="camp-end">End Date</label>
                <input id="camp-end" type="date" className="field-input" value={form.end_date} onChange={set("end_date")} />
              </div>
            </div>

            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="camp-budget">Budget (₹)</label>
                <input id="camp-budget" type="number" className="field-input" value={form.budget} onChange={set("budget")} placeholder="0.00" min="0" step="0.01" />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="camp-status">Status</label>
                <select id="camp-status" className="field-input" value={form.status} onChange={set("status")}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="camp-notes">Notes</label>
              <textarea id="camp-notes" className="field-input" rows={3} value={form.notes} onChange={set("notes")} placeholder="Optional campaign notes…" />
            </div>

            {error && <div className="form-error">{error}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Campaign"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
