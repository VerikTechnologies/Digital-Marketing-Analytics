import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import QRCode from "qrcode";
import { UAParser } from "ua-parser-js";
import geoip from "geoip-lite";
import crypto from "crypto";

dotenv.config();

const app = express();
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(x=>x.trim()) : true }));
app.use(express.json({ limit: "2mb" })); 

// ── Supabase clients ──────────────────────────────────────────────────────────
// Admin client (service role key) — used for auth admin operations (createUser, listUsers, getUser)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Anon client — used for signInWithPassword (user-facing auth)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── PostgreSQL pool (direct connection to Supabase Postgres) ─────────────────
const { Pool } = pg;
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false },
  max: 30 
});

const PORT = Number(process.env.PORT || 4000);

// ── Helpers ───────────────────────────────────────────────────────────────────
const slugify = s => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
const makeCode = () => `VK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const qrUrl = code => `${(process.env.PUBLIC_QR_BASE_URL || "http://localhost:4000/qr").replace(/\/$/, "")}/${code}`;

const cache = new Map();
function getCache(key) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiry) return hit.data;
  return null;
}
function setCache(key, data, ttl = 30000) {
  cache.set(key, { data, expiry: Date.now() + ttl });
}

// Auth middleware — verifies Supabase JWT via getUser
const auth = async (req, res, next) => {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query.token;
  if (!t) return res.status(401).json({ error: "Authentication required" });
  const { data, error } = await supabaseAdmin.auth.getUser(t);
  if (error || !data?.user) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = data.user;
  next();
};

const clientIp = req => String(req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "").split(",")[0].trim();
const ipHash = req => crypto.createHash("sha256").update(`${clientIp(req)}|${process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest("hex");

function visitor(req) {
  const ua = req.headers["user-agent"] || "";
  const p = new UAParser(ua).getResult();
  const g = process.env.GEOIP_ENABLED !== "false" ? geoip.lookup(clientIp(req)) : null;
  return {
    browser: p.browser?.name || "Unknown",
    browser_version: p.browser?.version || "",
    os: p.os?.name || "Unknown",
    os_version: p.os?.version || "",
    device: p.device?.model || p.device?.vendor || "Unknown",
    device_type: p.device?.type || "desktop",
    country: g?.country || null,
    city: g?.city || null,
    ip_hash: ipHash(req),
    referrer: req.get("referer") || null,
    user_agent: ua
  };
}
function smart(q, d, req) {
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  if (d.android_url && /android/.test(ua)) return ["android", d.android_url];
  // Match iOS devices only — exclude macOS desktop (which also contains "mac os x" in Safari UA)
  // A real iPhone/iPad/iPod UA always contains "mobile" or the device name; desktops do not.
  const isIos = /(iphone|ipad|ipod)/.test(ua) || (/(mac os x)/.test(ua) && /mobile/.test(ua));
  if (d.ios_url && isIos) return ["ios", d.ios_url];
  return ["website", d.website_url];
}
function addUtm(url, d) {
  try {
    const u = new URL(url);
    const m = { utm_source: d.utm_source, utm_medium: d.utm_medium, utm_campaign: d.utm_campaign, utm_content: d.utm_content, utm_term: d.utm_term };
    Object.entries(m).forEach(([k, v]) => { if (v) u.searchParams.set(k, v) });
    return u.toString();
  } catch { return url }
}
async function audit(user, action, type, id, details = {}) {
  await pool.query(
    "INSERT INTO audit_logs(admin_user_id, action, entity_type, entity_id, details) VALUES($1,$2,$3,$4,$5)",
    [user?.id || null, action, type, id, JSON.stringify(details)]
  );
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function ensureAdmin() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  if (!data.users.length) {
    const email = process.env.ADMIN_EMAIL || "admin@verik.com";
    const password = process.env.ADMIN_PASSWORD || "change-me-now";
    const { error: ce } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (ce) throw ce;
    console.log(`[bootstrap] Admin user created: ${email}`);
  }
}
async function ensureSample() {
  const { rows: [brand] } = await pool.query("SELECT id FROM brands WHERE slug='joeyrooms' LIMIT 1");
  if (!brand) return;
  const { rows: [camp] } = await pool.query("SELECT id FROM campaigns WHERE slug='ganesh-festival-2026' LIMIT 1");
  let cid = camp?.id;
  if (!cid) {
    const { rows: [r] } = await pool.query(
      "INSERT INTO campaigns(brand_id,name,slug,campaign_type,status) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [brand.id, "Ganesh Festival 2026", "ganesh-festival-2026", "Offline", "active"]
    );
    cid = r.id;
  }
  const { rows: existing } = await pool.query("SELECT id FROM qrs WHERE code='VK-JR-GANESH-01' LIMIT 1");
  if (!existing.length) {
    const { rows: [r] } = await pool.query(
      "INSERT INTO qrs(brand_id,campaign_id,name,code,channel,location) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [brand.id, cid, "Joeyrooms Ganesh Gachibowli", "VK-JR-GANESH-01", "Flyer", "Gachibowli"]
    );
    await pool.query(
      "INSERT INTO destinations(qr_id,website_url,utm_source,utm_medium,utm_campaign,utm_content) VALUES($1,$2,$3,$4,$5,$6)",
      [r.id, "https://joeyrooms.com/", "offline", "flyer", "ganesh_festival_2026", "gachibowli_01"]
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, service: "verik-universal-qr" }) }
  catch { res.status(503).json({ ok: false }) }
});

// Auth ─────────────────────────────────────────────────────────────────────────
// Login accepts { email, password } or { username, password } (username treated as email)
app.post("/api/auth/login", async (req, res) => {
  const raw = req.body?.username || req.body?.email || "";
  // If username looks like a bare word (no @), substitute the configured admin email
  const email = raw.includes("@") ? raw : (process.env.ADMIN_EMAIL || "admin@verik.com");
  const password = req.body?.password || "";
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: data.session.access_token, user: { id: data.user.id, username: data.user.email } });
});
app.get("/api/auth/me", auth, (req, res) => res.json({ user: { id: req.user.id, username: req.user.email } }));

// Brands ───────────────────────────────────────────────────────────────────────
app.get("/api/brands", auth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*, COUNT(DISTINCT c.id) campaigns, COUNT(DISTINCT q.id) qrs
    FROM brands b
    LEFT JOIN campaigns c ON c.brand_id = b.id
    LEFT JOIN qrs q ON q.brand_id = b.id
    GROUP BY b.id ORDER BY b.created_at DESC
  `);
  res.json(rows);
});
app.post("/api/brands", auth, async (req, res) => {
  const name = req.body?.name;
  if (!name) return res.status(400).json({ error: "name required" });
  const { rows: [r] } = await pool.query(
    "INSERT INTO brands(name,slug,website_url,logo_url,fb_pixel_id,ga_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [name, slugify(req.body.slug || name), req.body.website_url || null, req.body.logo_url || null, req.body.fb_pixel_id || null, req.body.ga_id || null]
  );
  await audit(req.user, "create", "brand", r.id, { name });
  res.status(201).json({ id: r.id });
});
app.put("/api/brands/:id", auth, async (req, res) => {
  await pool.query(
    "UPDATE brands SET name=COALESCE($1,name), slug=COALESCE($2,slug), website_url=COALESCE($3,website_url), logo_url=COALESCE($4,logo_url), fb_pixel_id=COALESCE($5,fb_pixel_id), ga_id=COALESCE($6,ga_id), active=COALESCE($7,active) WHERE id=$8",
    [req.body.name || null, req.body.slug ? slugify(req.body.slug) : null, req.body.website_url || null, req.body.logo_url || null, req.body.fb_pixel_id ?? null, req.body.ga_id ?? null, req.body.active ?? null, req.params.id]
  );
  await audit(req.user, "update", "brand", req.params.id, req.body);
  res.json({ ok: true });
});
app.delete("/api/brands/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM brands WHERE id=$1", [req.params.id]);
  await audit(req.user, "delete", "brand", req.params.id);
  res.status(204).end();
});

// Campaigns ────────────────────────────────────────────────────────────────────
app.get("/api/campaigns", auth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT c.*, b.name brand_name, COUNT(DISTINCT q.id) qrs, COUNT(s.id) scans
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
    LEFT JOIN qrs q ON q.campaign_id = c.id
    LEFT JOIN scans s ON s.qr_id = q.id
    GROUP BY c.id, b.name ORDER BY c.created_at DESC
  `);
  res.json(rows);
});
app.post("/api/campaigns", auth, async (req, res) => {
  if (!req.body?.brand_id || !req.body?.name) return res.status(400).json({ error: "brand_id and name required" });
  const { rows: [r] } = await pool.query(
    "INSERT INTO campaigns(brand_id,name,slug,campaign_type,start_date,end_date,budget,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
    [req.body.brand_id, req.body.name, slugify(req.body.slug || req.body.name), req.body.campaign_type || "", req.body.start_date || null, req.body.end_date || null, req.body.budget || null, req.body.status || "active", req.body.notes || null]
  );
  await audit(req.user, "create", "campaign", r.id, req.body);
  res.status(201).json({ id: r.id });
});
app.put("/api/campaigns/:id", auth, async (req, res) => {
  const f = ["name", "slug", "campaign_type", "start_date", "end_date", "budget", "status", "notes"];
  const keys = f.filter(k => req.body[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: "No changes" });
  const vals = keys.map(k => k === "slug" ? slugify(req.body[k]) : req.body[k]);
  await pool.query(
    `UPDATE campaigns SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${keys.length + 1}`,
    [...vals, req.params.id]
  );
  await audit(req.user, "update", "campaign", req.params.id, req.body);
  res.json({ ok: true });
});
app.delete("/api/campaigns/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM campaigns WHERE id=$1", [req.params.id]);
  await audit(req.user, "delete", "campaign", req.params.id);
  res.status(204).end();
});

// QRs ──────────────────────────────────────────────────────────────────────────
app.get("/api/qrs", auth, async (_req, res) => {
  // Use a single aggregating JOIN instead of correlated subqueries to avoid
  // O(n) extra queries. CURRENT_DATE is cast in IST (UTC+5:30) so "today" aligns
  // with the local business day rather than UTC midnight.
  const { rows } = await pool.query(`
    SELECT q.*, b.name brand_name, c.name campaign_name,
      COALESCE(agg.total_scans, 0)  AS scans,
      COALESCE(agg.today_scans, 0)  AS today
    FROM qrs q
    JOIN brands b    ON b.id = q.brand_id
    JOIN campaigns c ON c.id = q.campaign_id
    LEFT JOIN (
      SELECT
        qr_id,
        COUNT(*)                                                       AS total_scans,
        COUNT(*) FILTER (WHERE scanned_at >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
                                                                       AS today_scans
      FROM scans
      GROUP BY qr_id
    ) agg ON agg.qr_id = q.id
    ORDER BY q.created_at DESC
  `);
  res.json(rows.map(x => ({ ...x, public_url: qrUrl(x.code) })));
});
app.get("/api/qrs/:id", auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.*, b.name brand_name, c.name campaign_name
    FROM qrs q
    JOIN brands b ON b.id = q.brand_id
    JOIN campaigns c ON c.id = q.campaign_id
    WHERE q.id = $1
  `, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "QR not found" });
  const { rows: dest } = await pool.query(
    "SELECT * FROM destinations WHERE qr_id=$1 ORDER BY effective_from DESC LIMIT 1",
    [req.params.id]
  );
  res.json({ ...rows[0], public_url: qrUrl(rows[0].code), destination: dest[0] || null });
});
app.post("/api/qrs", auth, async (req, res) => {
  const { brand_id, campaign_id, name, code, channel, location, active = true, website_url, android_url, ios_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body || {};
  if (!brand_id || !campaign_id || !name || !website_url) return res.status(400).json({ error: "brand_id, campaign_id, name and website_url required" });
  const finalCode = (code || makeCode()).toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  try {
    const { rows: [r] } = await pool.query(
      "INSERT INTO qrs(brand_id,campaign_id,name,code,channel,location,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [brand_id, campaign_id, name, finalCode, channel || "", location || "", !!active]
    );
    await pool.query(
      "INSERT INTO destinations(qr_id,website_url,android_url,ios_url,utm_source,utm_medium,utm_campaign,utm_content,utm_term) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [r.id, website_url, android_url || null, ios_url || null, utm_source || "", utm_medium || "", utm_campaign || "", utm_content || "", utm_term || ""]
    );
    await audit(req.user, "create", "qr", r.id, { code: finalCode });
    res.status(201).json({ id: r.id, code: finalCode, public_url: qrUrl(finalCode) });
  } catch (e) {
    console.error("QR Create Error:", e);
    res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "QR code already exists" : "Failed to create QR" });
  }
});
app.put("/api/qrs/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const f = ["name", "channel", "location", "active"];
  const keys = f.filter(k => req.body[k] !== undefined);
  if (keys.length) await pool.query(
    `UPDATE qrs SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${keys.length + 1}`,
    [...keys.map(k => req.body[k]), id]
  );
  const destinationFields = ["website_url", "android_url", "ios_url", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fb_pixel_id", "ga_id"];
  const dk = destinationFields.filter(k => req.body[k] !== undefined);
  if (dk.length) {
    await pool.query("UPDATE destinations SET effective_to=NOW() WHERE qr_id=$1 AND effective_to IS NULL", [id]);
    const { rows: [current] } = await pool.query("SELECT * FROM destinations WHERE qr_id=$1 ORDER BY effective_from DESC LIMIT 1", [id]);
    const base = current || {};
    const vals = destinationFields.map(k => req.body[k] !== undefined ? req.body[k] : (base[k] ?? null));
    await pool.query(
      "INSERT INTO destinations(qr_id,website_url,android_url,ios_url,utm_source,utm_medium,utm_campaign,utm_content,utm_term,fb_pixel_id,ga_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id, ...vals]
    );
  }
  await audit(req.user, "update", "qr", id, req.body);
  res.json({ ok: true });
});
app.delete("/api/qrs/:id", auth, async (req, res) => {
  await pool.query("UPDATE qrs SET active=FALSE WHERE id=$1", [req.params.id]);
  await audit(req.user, "disable", "qr", req.params.id);
  res.status(204).end();
});

// QR image generation
async function qrImage(req, res, type) {
  const { rows } = await pool.query("SELECT code FROM qrs WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).send("Not found");
  const value = qrUrl(rows[0].code);
  if (type === "svg") {
    res.type("image/svg+xml").send(await QRCode.toString(value, { type: "svg", errorCorrectionLevel: "H", margin: 2, color: { dark: "#0B1320", light: "#FFFFFF" } }));
  } else {
    res.type("image/png").send(await QRCode.toBuffer(value, { errorCorrectionLevel: "H", margin: 2, width: 1400, color: { dark: "#0B1320", light: "#FFFFFF" } }));
  }
}
app.get("/api/qrs/:id/png", auth, (req, res) => qrImage(req, res, "png"));
app.get("/api/qrs/:id/svg", auth, (req, res) => qrImage(req, res, "svg"));
app.get("/api/qrs/:id/history", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM destinations WHERE qr_id=$1 ORDER BY effective_from DESC", [req.params.id]);
  res.json(rows);
});
app.get("/api/qrs/:id/scans.csv", auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.scanned_at, b.name brand, c.name campaign, q.name qr_name, q.code, q.channel, q.location,
      s.country, s.city, s.browser, s.browser_version, s.os, s.os_version, s.device, s.device_type, s.referrer, s.destination_type
    FROM scans s
    JOIN qrs q ON q.id = s.qr_id
    JOIN brands b ON b.id = q.brand_id
    JOIN campaigns c ON c.id = q.campaign_id
    WHERE q.id = $1 ORDER BY s.scanned_at DESC
  `, [req.params.id]);
  const cols = ["scanned_at","brand","campaign","qr_name","code","channel","location","country","city","browser","browser_version","os","os_version","device","device_type","referrer","destination_type"];
  const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
  res.type("text/csv")
    .set("Content-Disposition", `attachment; filename="${req.params.id}-scans.csv"`)
    .send([cols.join(","), ...rows.map(x => cols.map(c => esc(x[c])).join(","))].join("\n"));
});

// Analytics ────────────────────────────────────────────────────────────────────
app.get("/api/analytics/summary", auth, async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number(req.query.range || 30)));
  const cacheKey = `summary:${days}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const [
    { rows: [scans] },
    { rows: [today] },
    { rows: [qrs] },
    { rows: [brands] },
    { rows: [campaigns] },
    { rows: top }
  ] = await Promise.all([
    pool.query("SELECT COUNT(*) c FROM scans WHERE scanned_at >= NOW() - $1 * INTERVAL '1 day'", [days]),
    // Cast to IST date so "today" reflects the local business day, not UTC midnight
    pool.query("SELECT COUNT(*) c FROM scans WHERE scanned_at >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date"),
    // Count only active QR codes so the KPI label matches reality
    pool.query("SELECT COUNT(*) c FROM qrs WHERE active=TRUE"),
    pool.query("SELECT COUNT(*) c FROM brands WHERE active=TRUE"),
    pool.query("SELECT COUNT(*) c FROM campaigns WHERE status='active'"),
    pool.query(
      "SELECT q.name, q.code, COUNT(*) scans FROM scans s JOIN qrs q ON q.id=s.qr_id WHERE s.scanned_at >= NOW() - $1 * INTERVAL '1 day' GROUP BY q.id, q.name, q.code ORDER BY scans DESC LIMIT 10",
      [days]
    )
  ]);
  const result = { scans: Number(scans.c), today: Number(today.c), qrs: Number(qrs.c), brands: Number(brands.c), campaigns: Number(campaigns.c), top };
  setCache(cacheKey, result);
  res.json(result);
});
app.get("/api/analytics/timeseries", auth, async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number(req.query.range || 30)));
  const cacheKey = `timeseries:${days}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const { rows } = await pool.query(
    "SELECT DATE(scanned_at) date, COUNT(*) scans FROM scans WHERE scanned_at >= CURRENT_DATE - $1 * INTERVAL '1 day' GROUP BY DATE(scanned_at) ORDER BY date",
    [days]
  );
  setCache(cacheKey, rows);
  res.json(rows);
});
app.get("/api/analytics/breakdown", auth, async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number(req.query.range || 30)));
  const cacheKey = `breakdown:${days}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  async function group(field) {
    const { rows } = await pool.query(
      `SELECT COALESCE(${field},'Unknown') label, COUNT(*) value FROM scans WHERE scanned_at >= NOW() - $1 * INTERVAL '1 day' GROUP BY ${field} ORDER BY value DESC LIMIT 12`,
      [days]
    );
    return rows;
  }
  
  const [browser, os, device, country, city, destination] = await Promise.all([
    group("browser"), group("os"), group("device_type"),
    group("country"), group("city"), group("destination_type")
  ]);
  
  const result = { browser, os, device, country, city, destination };
  setCache(cacheKey, result);
  res.json(result);
});
app.get("/api/analytics/export", auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT 
      s.scanned_at,
      q.code AS qr_code,
      q.name AS qr_name,
      b.name AS brand_name,
      c.name AS campaign_name,
      s.country,
      s.city,
      s.browser,
      s.os,
      s.device,
      s.device_type,
      s.referrer,
      d.utm_source,
      d.utm_medium,
      d.utm_campaign,
      d.utm_content,
      d.utm_term
    FROM scans s
    JOIN qrs q ON s.qr_id = q.id
    JOIN brands b ON q.brand_id = b.id
    JOIN campaigns c ON q.campaign_id = c.id
    JOIN destinations d ON s.destination_id = d.id
    ORDER BY s.scanned_at DESC
  `);
  
  const headers = ["Scanned At", "QR Code", "QR Name", "Brand", "Campaign", "Country", "City", "Browser", "OS", "Device", "Device Type", "Referrer", "UTM Source", "UTM Medium", "UTM Campaign", "UTM Content", "UTM Term"];
  const csv = [
    headers.join(","),
    ...rows.map(r => [
      r.scanned_at, r.qr_code, `"${(r.qr_name || "").replace(/"/g, '""')}"`, `"${(r.brand_name || "").replace(/"/g, '""')}"`, `"${(r.campaign_name || "").replace(/"/g, '""')}"`,
      r.country || "", r.city || "", r.browser || "", r.os || "", r.device || "", r.device_type || "", `"${(r.referrer || "").replace(/"/g, '""')}"`,
      r.utm_source || "", r.utm_medium || "", r.utm_campaign || "", r.utm_content || "", r.utm_term || ""
    ].join(","))
  ].join("\n");
  
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="analytics_export.csv"');
  res.send(csv);
});

// QR redirect ─────────────────────────────────────────────────────────────────
app.get("/qr/:code", async (req, res) => {
  const { rows: [q] } = await pool.query("SELECT * FROM qrs WHERE code=$1 AND active=TRUE LIMIT 1", [req.params.code]);
  if (!q) return res.status(404).send("QR code is unavailable.");
  const { rows: [d] } = await pool.query("SELECT * FROM destinations WHERE qr_id=$1 AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1", [q.id]);
  if (!d) return res.status(404).send("QR destination is unavailable.");
  
  const { rows: [b] } = await pool.query("SELECT fb_pixel_id, ga_id FROM brands WHERE id=$1 LIMIT 1", [q.brand_id]);
  const fbPixel = d.fb_pixel_id || (b && b.fb_pixel_id);
  const gaId = d.ga_id || (b && b.ga_id);

  const v = visitor(req), [type, target] = smart(q, d, req), destination = addUtm(target, d);
  await pool.query(
    "INSERT INTO scans(qr_id,destination_id,ip_hash,country,city,browser,browser_version,os,os_version,device,device_type,referrer,user_agent,destination_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [q.id, d.id, v.ip_hash, v.country, v.city, v.browser, v.browser_version, v.os, v.os_version, v.device, v.device_type, v.referrer, v.user_agent, type]
  );
  
  if (fbPixel || gaId) {
    res.removeHeader("Content-Security-Policy");
    res.removeHeader("Cross-Origin-Opener-Policy");
    res.removeHeader("Cross-Origin-Resource-Policy");
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting...</title>`;
    html += `<noscript><meta http-equiv="refresh" content="0; url=${destination}"></noscript>`;
    if (gaId) {
      html += `
<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${gaId}');
</script>`;
    }
    if (fbPixel) {
      html += `
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${fbPixel}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${fbPixel}&ev=PageView&noscript=1"/></noscript>`;
    }
    html += `</head><body style="background:#fff;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#333;">`;
    html += `<div style="text-align:center;"><div style="width:24px;height:24px;border:3px solid #f3f3f3;border-top:3px solid #3B82F6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px auto;"></div><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style><div style="font-size:14px;font-weight:500;">Redirecting...</div></div>`;
    html += `<script>setTimeout(function(){ window.location.replace('${destination}'); }, 100);</script>`;
    html += `</body></html>`;
    return res.send(html);
  }

  res.redirect(302, destination);
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  await ensureAdmin();
  await ensureSample();
  app.listen(PORT, () => console.log(`Verik Universal QR API listening on port ${PORT}`));
}
start().catch(e => { console.error(e); process.exit(1) });
