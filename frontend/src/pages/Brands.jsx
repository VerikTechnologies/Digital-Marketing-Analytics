import { useState, useEffect } from "react";
import { Plus, Building2, Globe, QrCode, Megaphone, Pencil, Trash2, RefreshCw } from "lucide-react";
import Modal from "../components/Modal";
import StatusPill from "../components/StatusPill";
import api from "../api";

export const brandsCache = { brands: null };

export async function preloadBrands() {
  try {
    const res = await api.get("/api/brands");
    brandsCache.brands = res.data;
  } catch (e) { console.error("Preload error", e); }
}

const EMPTY_FORM = { name: "", slug: "", website_url: "", logo_url: "", fb_pixel_id: "", ga_id: "" };

export default function Brands() {
  const [brands,  setBrands]  = useState(brandsCache.brands || []);
  const [open,    setOpen]    = useState(false);
  const [editing, setEditing] = useState(null);   // brand object when editing
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  async function load() {
    const res = await api.get("/api/brands");
    setBrands(res.data);
    brandsCache.brands = res.data;
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setOpen(true);
  }

  function openEdit(brand) {
    setEditing(brand);
    setForm({ name: brand.name, slug: brand.slug, website_url: brand.website_url || "", logo_url: brand.logo_url || "", fb_pixel_id: brand.fb_pixel_id || "", ga_id: brand.ga_id || "" });
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/brands/${editing.id}`, form);
      } else {
        await api.post("/api/brands", form);
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save brand.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(brand) {
    await api.put(`/api/brands/${brand.id}`, { active: !brand.active });
    load();
  }

  async function handleDelete(brand) {
    if (!confirm(`Delete brand "${brand.name}"? This cannot be undone.`)) return;
    await api.delete(`/api/brands/${brand.id}`);
    load();
  }

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  return (
    <div className="page-content">
      <div className="toolbar">
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="record-count">{brands.length} brand{brands.length !== 1 ? "s" : ""}</span>
          <button className="btn btn--secondary" onClick={() => { brandsCache.brands = null; load(); }} title="Refresh Data">
            <RefreshCw size={16} />
          </button>
        </div>
        <button id="add-brand-btn" className="btn btn--primary" onClick={openCreate}>
          <Plus size={16} /> Add Brand
        </button>
      </div>

      <div className="card-grid">
        {brands.map((b) => (
          <div key={b.id} className={`brand-card${!b.active ? " brand-card--inactive" : ""}`}>
            <div className="brand-card-header">
              <div className="brand-avatar">
                {b.logo_url
                  ? <img src={b.logo_url} alt={b.name} className="brand-logo" />
                  : <Building2 size={22} />
                }
              </div>
              <StatusPill active={!!b.active} />
            </div>

            <h3 className="brand-name">{b.name}</h3>
            <p className="brand-slug">/{b.slug}</p>

            {b.website_url && (
              <a className="brand-link" href={b.website_url} target="_blank" rel="noreferrer">
                <Globe size={13} /> {b.website_url.replace(/^https?:\/\//, "")}
              </a>
            )}

            <div className="brand-stats">
              <span><Megaphone size={13} /> {b.campaigns} campaigns</span>
              <span><QrCode size={13} /> {b.qrs} QR codes</span>
            </div>

            <div className="brand-actions">
              <button className="btn-icon" title="Edit" onClick={() => openEdit(b)}>
                <Pencil size={14} />
              </button>
              <button
                className={`btn-icon${b.active ? "" : " btn-icon--on"}`}
                title={b.active ? "Disable" : "Enable"}
                onClick={() => handleToggle(b)}
              >
                {b.active ? "Disable" : "Enable"}
              </button>
              <button className="btn-icon btn-icon--danger" title="Delete" onClick={() => handleDelete(b)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {brands.length === 0 && (
          <div className="empty-card">
            <Building2 size={40} />
            <p>No brands yet. Add your first brand to get started.</p>
          </div>
        )}
      </div>

      {open && (
        <Modal title={editing ? "Edit Brand" : "Add Brand"} onClose={() => setOpen(false)}>
          <form id="brand-form" onSubmit={handleSubmit} className="form">
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="brand-name">Brand Name *</label>
                <input id="brand-name" className="field-input" required value={form.name} onChange={set("name")} placeholder="e.g. Joeyrooms" />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="brand-slug">Slug</label>
                <input id="brand-slug" className="field-input" value={form.slug} onChange={set("slug")} placeholder="auto-generated if blank" />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="brand-url">Website URL</label>
              <input id="brand-url" className="field-input" type="url" value={form.website_url} onChange={set("website_url")} placeholder="https://example.com" />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="brand-logo">Logo URL</label>
              <input id="brand-logo" className="field-input" type="url" value={form.logo_url} onChange={set("logo_url")} placeholder="https://example.com/logo.png" />
            </div>
            
            <div className="form-section-label" style={{ marginTop: '20px', marginBottom: '10px', fontSize: '13px', fontWeight: '600', color: 'var(--text-2)' }}>Tracking Pixels (Optional)</div>
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="brand-fb-pixel">Meta (FB) Pixel ID</label>
                <input id="brand-fb-pixel" className="field-input" value={form.fb_pixel_id} onChange={set("fb_pixel_id")} placeholder="e.g. 1234567890" />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="brand-ga-id">Google Analytics ID</label>
                <input id="brand-ga-id" className="field-input" value={form.ga_id} onChange={set("ga_id")} placeholder="e.g. G-XXXXXXX" />
              </div>
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Add Brand"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
