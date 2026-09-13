import { useState, useEffect } from "react";
import {
  Plus, Power, Download, Copy, ExternalLink, Pencil, History, Eye, RefreshCw
} from "lucide-react";
import Modal from "../components/Modal";
import StatusPill from "../components/StatusPill";
import api from "../api";

const CHANNELS = ["Flyer", "Poster", "Pamphlet", "Instagram", "Google", "Facebook", "WhatsApp", "Banner", "Standee", "Other"];

const EMPTY_FORM = {
  brand_id: "", campaign_id: "", name: "", code: "", channel: "",
  location: "", website_url: "", android_url: "", ios_url: "",
  utm_source: "offline", utm_medium: "qr", utm_campaign: "", utm_content: "", utm_term: "",
  fb_pixel_id: "", ga_id: "",
};

function HistoryModal({ qrId, qrName, onClose }) {
  const [history, setHistory] = useState([]);
  useEffect(() => {
    api.get(`/api/qrs/${qrId}/history`).then((r) => setHistory(r.data));
  }, [qrId]);
  return (
    <Modal title={`Destination History — ${qrName}`} onClose={onClose} wide>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Active From</th><th>Active To</th><th>Website URL</th><th>Android</th><th>iOS</th><th>UTM Campaign</th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td><small>{h.effective_from?.slice(0, 16)}</small></td>
                <td><small>{h.effective_to ? h.effective_to.slice(0, 16) : <span className="pill pill--green">Current</span>}</small></td>
                <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                  <a href={h.website_url} target="_blank" rel="noreferrer" className="link-sm">{h.website_url}</a>
                </td>
                <td><small>{h.android_url || "—"}</small></td>
                <td><small>{h.ios_url || "—"}</small></td>
                <td><small>{h.utm_campaign || "—"}</small></td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={6} className="empty-state">No destination history.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function DestModal({ qr, onClose, onSaved }) {
  const [form, setForm] = useState({
    website_url: qr.destination?.website_url || "",
    android_url: qr.destination?.android_url || "",
    ios_url: qr.destination?.ios_url || "",
    utm_source: qr.destination?.utm_source || "",
    utm_medium: qr.destination?.utm_medium || "",
    utm_campaign: qr.destination?.utm_campaign || "",
    utm_content: qr.destination?.utm_content || "",
    utm_term: qr.destination?.utm_term || "",
    fb_pixel_id: qr.destination?.fb_pixel_id || "",
    ga_id: qr.destination?.ga_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }
  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      await api.put(`/api/qrs/${qr.id}`, form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update destination.");
    } finally { setSaving(false); }
  }
  return (
    <Modal title={`Edit Destination — ${qr.name}`} onClose={onClose} wide>
      <p className="modal-hint">Updating the destination creates a new version in history. The QR URL never changes.</p>
      <form id="dest-form" onSubmit={handleSubmit} className="form">
        <div className="field-group">
          <label className="field-label" htmlFor="dest-web">Website URL *</label>
          <input id="dest-web" className="field-input" type="url" required value={form.website_url} onChange={set("website_url")} />
        </div>
        <div className="form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="dest-android">Android URL</label>
            <input id="dest-android" className="field-input" type="url" value={form.android_url} onChange={set("android_url")} placeholder="Optional" />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="dest-ios">iOS URL</label>
            <input id="dest-ios" className="field-input" type="url" value={form.ios_url} onChange={set("ios_url")} placeholder="Optional" />
          </div>
        </div>
        <div className="form-section-label">UTM Parameters</div>
        <div className="form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="utm-src">utm_source</label>
            <input id="utm-src" className="field-input" value={form.utm_source} onChange={set("utm_source")} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="utm-med">utm_medium</label>
            <input id="utm-med" className="field-input" value={form.utm_medium} onChange={set("utm_medium")} />
          </div>
        </div>
        <div className="form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="utm-camp">utm_campaign</label>
            <input id="utm-camp" className="field-input" value={form.utm_campaign} onChange={set("utm_campaign")} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="utm-cont">utm_content</label>
            <input id="utm-cont" className="field-input" value={form.utm_content} onChange={set("utm_content")} />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="utm-term">utm_term</label>
          <input id="utm-term" className="field-input" value={form.utm_term} onChange={set("utm_term")} />
        </div>
        
        <div className="form-section-label" style={{ marginTop: '20px', marginBottom: '10px', fontSize: '13px', fontWeight: '600', color: 'var(--text-2)' }}>Tracking Pixels (Optional)</div>
        <div className="form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="dest-fb">Meta (FB) Pixel ID</label>
            <input id="dest-fb" className="field-input" value={form.fb_pixel_id} onChange={set("fb_pixel_id")} placeholder="Overrides Brand settings" />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="dest-ga">Google Analytics ID</label>
            <input id="dest-ga" className="field-input" value={form.ga_id} onChange={set("ga_id")} placeholder="Overrides Brand settings" />
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Update Destination"}</button>
        </div>
      </form>
    </Modal>
  );
}

export const qrCache = {
  qrs: null,
  brands: null,
  campaigns: null,
  timestamp: 0
};

export async function preloadQRCodes() {
  try {
    const [q, b, c] = await Promise.all([
      api.get("/api/qrs"),
      api.get("/api/brands"),
      api.get("/api/campaigns"),
    ]);
    qrCache.qrs = q.data;
    qrCache.brands = b.data;
    qrCache.campaigns = c.data;
    qrCache.timestamp = Date.now();
  } catch (e) { console.error("Preload error", e); }
}

export default function QRCodes() {
  const [qrs,       setQrs]       = useState(qrCache.qrs || []);
  const [brands,    setBrands]    = useState(qrCache.brands || []);
  const [campaigns, setCampaigns] = useState(qrCache.campaigns || []);
  const [open,      setOpen]      = useState(false);
  const [destQr,    setDestQr]    = useState(null);
  const [histQr,    setHistQr]    = useState(null);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [copied,    setCopied]    = useState(null);
  const [search,    setSearch]    = useState("");

  async function load() {
    const [q, b, c] = await Promise.all([
      api.get("/api/qrs"),
      api.get("/api/brands"),
      api.get("/api/campaigns"),
    ]);
    setQrs(q.data);
    setBrands(b.data);
    setCampaigns(c.data);
    
    qrCache.qrs = q.data;
    qrCache.brands = b.data;
    qrCache.campaigns = c.data;
    qrCache.timestamp = Date.now();
  }

  useEffect(() => { load(); }, []);

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function handleCreate(e) {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      await api.post("/api/qrs", form);
      setOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create QR code.");
    } finally { setSaving(false); }
  }

  async function toggle(qr) {
    await api.put(`/api/qrs/${qr.id}`, { active: !qr.active });
    load();
  }

  async function copyUrl(qr) {
    await navigator.clipboard.writeText(qr.public_url);
    setCopied(qr.id);
    setTimeout(() => setCopied(null), 2000);
  }

  function download(id, type) { 
    const token = localStorage.getItem("vqr_token");
    window.open(`/api/qrs/${id}/${type}?token=${token}`, "_blank"); 
  }

  async function openDestEditor(qr) {
    const res = await api.get(`/api/qrs/${qr.id}`);
    setDestQr(res.data);
  }

  const filtered = search
    ? qrs.filter((q) =>
        q.name.toLowerCase().includes(search.toLowerCase()) ||
        q.code.toLowerCase().includes(search.toLowerCase()) ||
        q.brand_name.toLowerCase().includes(search.toLowerCase())
      )
    : qrs;

  const filteredCampaigns = campaigns.filter(
    (c) => !form.brand_id || String(c.brand_id) === String(form.brand_id)
  );

  return (
    <div className="page-content">
      <div className="toolbar">
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            className="search-input"
            placeholder="Search by code, name, brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn--secondary" onClick={() => { qrCache.qrs = null; load(); }} title="Refresh Data">
            <RefreshCw size={16} />
          </button>
        </div>
        <button className="btn btn--primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> New Link
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>QR Code</th>
              <th>Brand / Campaign</th>
              <th>Channel</th>
              <th>Location</th>
              <th>Scans</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((qr) => (
              <tr key={qr.id}>
                <td>
                  <strong>{qr.name}</strong>
                  <small className="code-badge">{qr.code}</small>
                </td>
                <td>
                  <span>{qr.brand_name}</span>
                  <small>{qr.campaign_name}</small>
                </td>
                <td>{qr.channel || "—"}</td>
                <td>{qr.location || "—"}</td>
                <td>
                  <span>{qr.scans}</span>
                  <small>Today: {qr.today}</small>
                </td>
                <td><StatusPill active={!!qr.active} /></td>
                <td>
                  <div className="row-actions">
                    <button className="btn-icon" title={qr.active ? "Disable QR" : "Enable QR"} onClick={() => toggle(qr)}>
                      <Power size={14} />
                    </button>
                    <button className="btn-icon" title="Edit destination" onClick={() => openDestEditor(qr)}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn-icon" title="Destination history" onClick={() => setHistQr(qr)}>
                      <History size={14} />
                    </button>
                    <button className="btn-icon" title={copied === qr.id ? "Copied!" : "Copy URL"} onClick={() => copyUrl(qr)}>
                      <Copy size={14} />
                      {copied === qr.id && <span className="copy-flash">✓</span>}
                    </button>
                    <button className="btn-icon" title="Download PNG" onClick={() => download(qr.id, "png")}>
                      <Download size={14} /><span>PNG</span>
                    </button>
                    <button className="btn-icon" title="Download SVG" onClick={() => download(qr.id, "svg")}>
                      <Download size={14} /><span>SVG</span>
                    </button>
                    <a className="btn-icon" href={qr.public_url} target="_blank" rel="noreferrer" title="Open QR URL">
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="empty-state">No QR codes found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create QR modal */}
      {open && (
        <Modal title="Create Permanent QR Code" onClose={() => setOpen(false)} wide>
          <p className="modal-hint">
            The QR URL is permanent. You can change the destination later without reprinting.
          </p>
          <form id="create-qr-form" onSubmit={handleCreate} className="form">
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="qr-brand">Brand *</label>
                <select id="qr-brand" className="field-input" required value={form.brand_id} onChange={set("brand_id")}>
                  <option value="">Select brand…</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qr-campaign">Campaign *</label>
                <select id="qr-campaign" className="field-input" required value={form.campaign_id} onChange={set("campaign_id")}>
                  <option value="">Select campaign…</option>
                  {filteredCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="qr-name">QR Name *</label>
              <input id="qr-name" className="field-input" required value={form.name} onChange={set("name")} placeholder="e.g. Joeyrooms Ganesh Gachibowli" />
            </div>

            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="qr-code">Custom Code</label>
                <input id="qr-code" className="field-input" value={form.code} onChange={set("code")} placeholder="Auto-generated if blank (e.g. VK-JR-GANESH-01)" />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qr-channel">Channel</label>
                <select id="qr-channel" className="field-input" value={form.channel} onChange={set("channel")}>
                  <option value="">Select…</option>
                  {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="qr-location">Location</label>
              <input id="qr-location" className="field-input" value={form.location} onChange={set("location")} placeholder="e.g. Gachibowli, Hyderabad" />
            </div>

            <div className="form-section-label">Destination URLs</div>
            <div className="field-group">
              <label className="field-label" htmlFor="qr-web">Website URL *</label>
              <input id="qr-web" className="field-input" type="url" required value={form.website_url} onChange={set("website_url")} placeholder="https://joeyrooms.com/" />
            </div>
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="qr-android">Android URL</label>
                <input id="qr-android" className="field-input" type="url" value={form.android_url} onChange={set("android_url")} placeholder="Optional app link" />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qr-ios">iOS URL</label>
                <input id="qr-ios" className="field-input" type="url" value={form.ios_url} onChange={set("ios_url")} placeholder="Optional app link" />
              </div>
            </div>

            <div className="form-section-label">UTM Parameters</div>
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="qr-utm-src">utm_source</label>
                <input id="qr-utm-src" className="field-input" value={form.utm_source} onChange={set("utm_source")} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qr-utm-med">utm_medium</label>
                <input id="qr-utm-med" className="field-input" value={form.utm_medium} onChange={set("utm_medium")} />
              </div>
            </div>
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="qr-utm-camp">utm_campaign</label>
                <input id="qr-utm-camp" className="field-input" value={form.utm_campaign} onChange={set("utm_campaign")} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qr-utm-cont">utm_content</label>
                <input id="qr-utm-cont" className="field-input" value={form.utm_content} onChange={set("utm_content")} />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="qr-utm-term">utm_term</label>
              <input id="qr-utm-term" className="field-input" value={form.utm_term} onChange={set("utm_term")} />
            </div>

            <div className="form-section-label" style={{ marginTop: '20px', marginBottom: '10px', fontSize: '13px', fontWeight: '600', color: 'var(--text-2)' }}>Tracking Pixels (Optional)</div>
            <div className="form-row">
              <div className="field-group">
                <label className="field-label" htmlFor="qr-fb">Meta (FB) Pixel ID</label>
                <input id="qr-fb" className="field-input" value={form.fb_pixel_id} onChange={set("fb_pixel_id")} placeholder="Overrides Brand settings" />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="qr-ga">Google Analytics ID</label>
                <input id="qr-ga" className="field-input" value={form.ga_id} onChange={set("ga_id")} placeholder="Overrides Brand settings" />
              </div>
            </div>

            {error && <div className="form-error">{error}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Creating…" : "Create QR Code"}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit destination modal */}
      {destQr && (
        <DestModal
          qr={destQr}
          onClose={() => setDestQr(null)}
          onSaved={() => { setDestQr(null); load(); }}
        />
      )}

      {/* History modal */}
      {histQr && (
        <HistoryModal
          qrId={histQr.id}
          qrName={histQr.name}
          onClose={() => setHistQr(null)}
        />
      )}
    </div>
  );
}
