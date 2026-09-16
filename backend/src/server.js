import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "./generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateBeautifulQR } from "./qrGenerator.js";
import pg from "pg";
import QRCode from "qrcode";
import { UAParser } from "ua-parser-js";
import geoip from "geoip-lite";
import crypto from "crypto";
import { rGet, rSet, rDel, rPushScan, rFlushScans } from "./redis.js";

// Fix BigInt JSON serialization globally
BigInt.prototype.toJSON = function () {
  return Number(this);
};

let flushTimeout = null;
function scheduleFlush() {
  if (!flushTimeout) {
    flushTimeout = setTimeout(async () => {
      flushTimeout = null;
      await flushScanBuffer();
    }, Number(process.env.SCAN_BUFFER_FLUSH_MS || 30000));
  }
}

const app = express();
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(x=>x.trim()) : true }));
app.use(express.json({ limit: "2mb" }));

// ── Prisma with PrismaPg driver adapter ──────────────────────────────────────
const { Pool } = pg;
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
});
const adapter = new PrismaPg(pgPool);
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

// ── Supabase clients ──────────────────────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PORT = Number(process.env.PORT || 4000);
// How often to flush the Redis scan buffer into PostgreSQL (default: 5s)
const FLUSH_MS = Number(process.env.SCAN_BUFFER_FLUSH_MS || 5000);

// ── Helpers ───────────────────────────────────────────────────────────────────
const slugify = s => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
const makeCode = () => `VK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const qrUrl = code => `${(process.env.PUBLIC_QR_BASE_URL || "http://localhost:4000/qr").replace(/\/$/, "")}/${code}`;
const bigInt = v => v !== undefined && v !== null ? BigInt(v) : v;
const safeNum = v => v !== undefined && v !== null ? Number(v) : v;

// ── Auth middleware ───────────────────────────────────────────────────────────
const auth = async (req, res, next) => {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query.token;
  if (!t) return res.status(401).json({ error: "Authentication required" });
  const { data, error } = await supabaseAdmin.auth.getUser(t);
  if (error || !data?.user) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = data.user;
  next();
};

// ── Visitor helpers ───────────────────────────────────────────────────────────
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
  await prisma.audit_logs.create({
    data: {
      admin_user_id: user?.id || null,
      action,
      entity_type: type,
      entity_id: id ? BigInt(id) : null,
      details,
    }
  });
}

// ── Redis scan buffer flush ───────────────────────────────────────────────────
// Scans are pushed to Redis instantly (non-blocking), then flushed to Postgres
// every FLUSH_MS. If Redis is unavailable, scans go directly to Postgres.
async function flushScanBuffer() {
  const scans = await rFlushScans(200);
  if (!scans.length) return;
  try {
    await prisma.scans.createMany({
      data: scans.map(s => ({
        ...s,
        qr_id: BigInt(s.qr_id),
        destination_id: s.destination_id ? BigInt(s.destination_id) : null,
      })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.error("[scan-buffer] Flush error:", e.message);
  }
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
  const brand = await prisma.brands.findFirst({ where: { slug: "joeyrooms" } });
  if (!brand) return;
  let camp = await prisma.campaigns.findFirst({ where: { slug: "ganesh-festival-2026" } });
  if (!camp) {
    camp = await prisma.campaigns.create({
      data: { brand_id: brand.id, name: "Ganesh Festival 2026", slug: "ganesh-festival-2026", campaign_type: "Offline", status: "active" }
    });
  }
  const existing = await prisma.qrs.findFirst({ where: { code: "VK-JR-GANESH-01" } });
  if (!existing) {
    const qr = await prisma.qrs.create({
      data: { brand_id: brand.id, campaign_id: camp.id, name: "Joeyrooms Ganesh Gachibowli", code: "VK-JR-GANESH-01", channel: "Flyer", location: "Gachibowli" }
    });
    await prisma.destinations.create({
      data: { qr_id: qr.id, website_url: "https://joeyrooms.com/", utm_source: "offline", utm_medium: "flyer", utm_campaign: "ganesh_festival_2026", utm_content: "gachibowli_01" }
    });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: "verik-universal-qr" });
  } catch { res.status(503).json({ ok: false }) }
});

// Auth ─────────────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const raw = req.body?.username || req.body?.email || "";
  const email = raw.includes("@") ? raw : (process.env.ADMIN_EMAIL || "admin@verik.com");
  const password = req.body?.password || "";
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: data.session.access_token, user: { id: data.user.id, username: data.user.email } });
});
app.get("/api/auth/me", auth, (req, res) => res.json({ user: { id: req.user.id, username: req.user.email } }));

// Brands ───────────────────────────────────────────────────────────────────────
app.get("/api/brands", auth, async (_req, res) => {
  // Trigger immediate flush so dashboard is up-to-date
  await flushScanBuffer();

  const cacheKey = "brands:all";
  const cached = await rGet(cacheKey);
  if (cached) return res.json(cached);

  const rows = await prisma.$queryRaw`
    SELECT b.*, COUNT(DISTINCT c.id)::int campaigns, COUNT(DISTINCT q.id)::int qrs
    FROM brands b
    LEFT JOIN campaigns c ON c.brand_id = b.id
    LEFT JOIN qrs q ON q.brand_id = b.id
    GROUP BY b.id ORDER BY b.created_at DESC
  `;
  // Serialize BigInt for JSON
  const result = rows.map(r => ({ ...r, id: Number(r.id), qrs: Number(r.qrs), campaigns: Number(r.campaigns) }));
  await rSet(cacheKey, result, 60);
  res.json(result);
});

app.post("/api/brands", auth, async (req, res) => {
  const name = req.body?.name;
  if (!name) return res.status(400).json({ error: "name required" });
  const brand = await prisma.brands.create({
    data: {
      name,
      slug: slugify(req.body.slug || name),
      website_url: req.body.website_url || null,
      logo_url: req.body.logo_url || null,
      fb_pixel_id: req.body.fb_pixel_id || null,
      ga_id: req.body.ga_id || null,
    }
  });
  await rDel("brands:all");
  await audit(req.user, "create", "brand", brand.id, { name });
  res.status(201).json({ id: Number(brand.id) });
});

app.put("/api/brands/:id", auth, async (req, res) => {
  const id = BigInt(req.params.id);
  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.slug !== undefined) data.slug = slugify(req.body.slug);
  if (req.body.website_url !== undefined) data.website_url = req.body.website_url;
  if (req.body.logo_url !== undefined) data.logo_url = req.body.logo_url;
  if (req.body.fb_pixel_id !== undefined) data.fb_pixel_id = req.body.fb_pixel_id;
  if (req.body.ga_id !== undefined) data.ga_id = req.body.ga_id;
  if (req.body.active !== undefined) data.active = req.body.active;
  await prisma.brands.update({ where: { id }, data });
  // Invalidate brand cache and any QR redirect caches referencing this brand
  await rDel("brands:all");
  await audit(req.user, "update", "brand", id, req.body);
  res.json({ ok: true });
});

app.delete("/api/brands/:id", auth, async (req, res) => {
  try {
    await prisma.brands.delete({ where: { id: BigInt(req.params.id) } });
    await rDel("brands:all");
    await audit(req.user, "delete", "brand", req.params.id);
    res.status(204).end();
  } catch (error) {
    if (error.code === 'P2003') {
      res.status(400).json({ error: "Cannot delete brand because it has active QR codes or campaigns." });
    } else {
      console.error(error);
      res.status(500).json({ error: "Failed to delete brand." });
    }
  }
});

// Campaigns ────────────────────────────────────────────────────────────────────
app.get("/api/campaigns", auth, async (_req, res) => {
  // Trigger immediate flush so dashboard is up-to-date
  await flushScanBuffer();

  const cacheKey = "campaigns:all";
  const cached = await rGet(cacheKey);
  if (cached) return res.json(cached);

  const rows = await prisma.$queryRaw`
    SELECT c.*, b.name brand_name, COUNT(DISTINCT q.id)::int qrs, COUNT(s.id)::int scans
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
    LEFT JOIN qrs q ON q.campaign_id = c.id
    LEFT JOIN scans s ON s.qr_id = q.id
    GROUP BY c.id, b.name ORDER BY c.created_at DESC
  `;
  const result = rows.map(r => ({ ...r, id: Number(r.id), brand_id: Number(r.brand_id), qrs: Number(r.qrs), scans: Number(r.scans) }));
  await rSet(cacheKey, result, 60);
  res.json(result);
});

app.post("/api/campaigns", auth, async (req, res) => {
  if (!req.body?.brand_id || !req.body?.name) return res.status(400).json({ error: "brand_id and name required" });
  const camp = await prisma.campaigns.create({
    data: {
      brand_id: BigInt(req.body.brand_id),
      name: req.body.name,
      slug: slugify(req.body.slug || req.body.name),
      campaign_type: req.body.campaign_type || "",
      start_date: req.body.start_date ? new Date(req.body.start_date) : null,
      end_date: req.body.end_date ? new Date(req.body.end_date) : null,
      budget: req.body.budget || null,
      status: req.body.status || "active",
      notes: req.body.notes || null,
    }
  });
  await rDel("campaigns:all");
  await audit(req.user, "create", "campaign", camp.id, req.body);
  res.status(201).json({ id: Number(camp.id) });
});

app.put("/api/campaigns/:id", auth, async (req, res) => {
  const id = BigInt(req.params.id);
  const data = {};
  const fields = ["name", "slug", "campaign_type", "start_date", "end_date", "budget", "status", "notes"];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === "slug") data.slug = slugify(req.body[f]);
      else if (f === "start_date" || f === "end_date") data[f] = req.body[f] ? new Date(req.body[f]) : null;
      else data[f] = req.body[f];
    }
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: "No changes" });
  await prisma.campaigns.update({ where: { id }, data });
  await rDel("campaigns:all");
  await audit(req.user, "update", "campaign", id, req.body);
  res.json({ ok: true });
});

app.delete("/api/campaigns/:id", auth, async (req, res) => {
  try {
    await prisma.campaigns.delete({ where: { id: BigInt(req.params.id) } });
    await rDel("campaigns:all");
    await audit(req.user, "delete", "campaign", req.params.id);
    res.status(204).end();
  } catch (error) {
    if (error.code === 'P2003') {
      res.status(400).json({ error: "Cannot delete campaign because it has active QR codes." });
    } else {
      console.error(error);
      res.status(500).json({ error: "Failed to delete campaign." });
    }
  }
});

// QRs ──────────────────────────────────────────────────────────────────────────
app.get("/api/qrs", auth, async (_req, res) => {
  // Trigger immediate flush so dashboard is up-to-date
  await flushScanBuffer();

  const cacheKey = "qrs:all";
  const cached = await rGet(cacheKey);
  if (cached) return res.json(cached);

  const rows = await prisma.$queryRaw`
    SELECT q.*, b.name brand_name, c.name campaign_name,
      COALESCE(agg.total_scans, 0)::int  AS scans,
      COALESCE(agg.today_scans, 0)::int  AS today
    FROM qrs q
    JOIN brands b    ON b.id = q.brand_id
    JOIN campaigns c ON c.id = q.campaign_id
    LEFT JOIN (
      SELECT qr_id,
        COUNT(*)                                                          AS total_scans,
        COUNT(*) FILTER (WHERE scanned_at >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_scans
      FROM scans GROUP BY qr_id
    ) agg ON agg.qr_id = q.id
    ORDER BY q.created_at DESC
  `;
  const result = rows.map(x => ({ ...x, id: Number(x.id), brand_id: Number(x.brand_id), campaign_id: Number(x.campaign_id), public_url: qrUrl(x.code) }));
  await rSet(cacheKey, result, 30);
  res.json(result);
});

app.get("/api/qrs/:id", auth, async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const qr = await prisma.qrs.findFirst({
      where: { id },
      include: { brands: true, campaigns: true }
    });
    if (!qr) return res.status(404).json({ error: "QR not found" });
    const dest = await prisma.destinations.findFirst({
      where: { qr_id: id },
      orderBy: { effective_from: "desc" }
    });
    const { brands, campaigns, ...safeQr } = qr;
    res.json({
      ...safeQr, id: Number(safeQr.id), brand_id: Number(safeQr.brand_id), campaign_id: Number(safeQr.campaign_id),
      brand_name: brands?.name || "Unknown Brand", campaign_name: campaigns?.name || "Unknown Campaign",
      public_url: qrUrl(safeQr.code),
      destination: dest ? { ...dest, id: Number(dest.id), qr_id: Number(dest.qr_id) } : null
    });
  } catch (e) {
    console.error("Error in GET /api/qrs/:id :", e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.post("/api/qrs", auth, async (req, res) => {
  const { brand_id, campaign_id, name, code, channel, location, active = true, website_url, android_url, ios_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body || {};
  if (!brand_id || !campaign_id || !name || !website_url) return res.status(400).json({ error: "brand_id, campaign_id, name and website_url required" });
  const finalCode = (code || makeCode()).toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  try {
    const qr = await prisma.qrs.create({
      data: {
        brand_id: BigInt(brand_id), campaign_id: BigInt(campaign_id), name, code: finalCode,
        channel: channel || "", location: location || "", active: !!active
      }
    });
    await prisma.destinations.create({
      data: {
        qr_id: qr.id, website_url,
        android_url: android_url || null, ios_url: ios_url || null,
        utm_source: utm_source || "", utm_medium: utm_medium || "",
        utm_campaign: utm_campaign || "", utm_content: utm_content || "", utm_term: utm_term || ""
      }
    });
    await rDel("qrs:all");
    await audit(req.user, "create", "qr", qr.id, { code: finalCode });
    res.status(201).json({ id: Number(qr.id), code: finalCode, public_url: qrUrl(finalCode) });
  } catch (e) {
    console.error("QR Create Error:", e);
    res.status(e.code === "P2002" ? 409 : 500).json({ error: e.code === "P2002" ? "QR code already exists" : "Failed to create QR" });
  }
});

app.put("/api/qrs/:id", auth, async (req, res) => {
  const id = BigInt(req.params.id);
  const qrData = {};
  for (const f of ["name", "channel", "location", "active"]) {
    if (req.body[f] !== undefined) qrData[f] = req.body[f];
  }
  if (Object.keys(qrData).length) await prisma.qrs.update({ where: { id }, data: qrData });

  const destinationFields = ["website_url", "android_url", "ios_url", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fb_pixel_id", "ga_id"];
  const dk = destinationFields.filter(k => req.body[k] !== undefined);
  if (dk.length) {
    await prisma.destinations.updateMany({ where: { qr_id: id, effective_to: null }, data: { effective_to: new Date() } });
    const current = await prisma.destinations.findFirst({ where: { qr_id: id }, orderBy: { effective_from: "desc" } });
    const base = current || {};
    await prisma.destinations.create({
      data: {
        qr_id: id,
        website_url: req.body.website_url ?? base.website_url ?? "",
        android_url: req.body.android_url !== undefined ? req.body.android_url : (base.android_url ?? null),
        ios_url: req.body.ios_url !== undefined ? req.body.ios_url : (base.ios_url ?? null),
        utm_source: req.body.utm_source ?? base.utm_source ?? "",
        utm_medium: req.body.utm_medium ?? base.utm_medium ?? "",
        utm_campaign: req.body.utm_campaign ?? base.utm_campaign ?? "",
        utm_content: req.body.utm_content ?? base.utm_content ?? "",
        utm_term: req.body.utm_term ?? base.utm_term ?? "",
        fb_pixel_id: req.body.fb_pixel_id !== undefined ? req.body.fb_pixel_id : (base.fb_pixel_id ?? null),
        ga_id: req.body.ga_id !== undefined ? req.body.ga_id : (base.ga_id ?? null),
      }
    });
  }
  // Invalidate both the QR list and the redirect cache for this QR's code
  const qr = await prisma.qrs.findFirst({ where: { id }, select: { code: true } });
  if (qr) await rDel("qrs:all", `qr:${qr.code}`);
  await audit(req.user, "update", "qr", id, req.body);
  res.json({ ok: true });
});

app.delete("/api/qrs/:id", auth, async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const qr = await prisma.qrs.findFirst({ where: { id }, select: { code: true } });
    if (qr) {
      await prisma.qrs.delete({ where: { id } });
      await rDel("qrs:all", `qr:${qr.code}`);
      await audit(req.user, "delete", "qr", req.params.id);
    }
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete QR code" });
  }
});

// QR image generation ─────────────────────────────────────────────────────────
async function qrImage(req, res, type) {
  const qr = await prisma.qrs.findFirst({ 
    where: { id: BigInt(req.params.id) }, 
    include: { brands: { select: { name: true, logo_url: true } } }
  });
  if (!qr) return res.status(404).send("Not found");
  const value = qrUrl(qr.code);
  
  try {
    if (type === "svg") {
      const svgString = await generateBeautifulQR(value, qr.name, qr.brands?.name, qr.brands?.logo_url, true);
      res.type("image/svg+xml").send(svgString);
    } else {
      const pngBuffer = await generateBeautifulQR(value, qr.name, qr.brands?.name, qr.brands?.logo_url, false);
      res.type("image/png").send(pngBuffer);
    }
  } catch (error) {
    console.error("QR Generation Error:", error);
    res.status(500).send("Error generating image");
  }
}
app.get("/api/qrs/:id/png", auth, (req, res) => qrImage(req, res, "png"));
app.get("/api/qrs/:id/svg", auth, (req, res) => qrImage(req, res, "svg"));
app.get("/api/qrs/:id/history", auth, async (req, res) => {
  const rows = await prisma.destinations.findMany({
    where: { qr_id: BigInt(req.params.id) },
    orderBy: { effective_from: "desc" }
  });
  res.json(rows.map(r => ({ ...r, id: Number(r.id), qr_id: Number(r.qr_id) })));
});

app.get("/api/qrs/:id/scans.csv", auth, async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT s.scanned_at, b.name brand, c.name campaign, q.name qr_name, q.code, q.channel, q.location,
      s.country, s.city, s.browser, s.browser_version, s.os, s.os_version, s.device, s.device_type, s.referrer, s.destination_type
    FROM scans s
    JOIN qrs q ON q.id = s.qr_id
    JOIN brands b ON b.id = q.brand_id
    JOIN campaigns c ON c.id = q.campaign_id
    WHERE q.id = ${BigInt(req.params.id)} ORDER BY s.scanned_at DESC
  `;
  const cols = ["scanned_at","brand","campaign","qr_name","code","channel","location","country","city","browser","browser_version","os","os_version","device","device_type","referrer","destination_type"];
  const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
  res.type("text/csv")
    .set("Content-Disposition", `attachment; filename="${req.params.id}-scans.csv"`)
    .send([cols.join(","), ...rows.map(x => cols.map(c => esc(x[c])).join(","))].join("\n"));
});

// Analytics ────────────────────────────────────────────────────────────────────
app.get("/api/analytics/summary", auth, async (req, res) => {
  // Trigger immediate flush so dashboard is up-to-date
  await flushScanBuffer();

  const days = Math.min(3650, Math.max(1, Number(req.query.range || 30)));
  const cacheKey = `analytics:summary:${days}`;
  const cached = await rGet(cacheKey);
  if (cached) return res.json(cached);

  const [scansRow, todayRow, qrsRow, brandsRow, campsRow, top] = await Promise.all([
    prisma.$queryRaw`SELECT COUNT(*)::int c FROM scans WHERE scanned_at >= NOW() - ${days} * INTERVAL '1 day'`,
    prisma.$queryRaw`SELECT COUNT(*)::int c FROM scans WHERE scanned_at >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
    prisma.$queryRaw`SELECT COUNT(*)::int c FROM qrs WHERE active=TRUE`,
    prisma.$queryRaw`SELECT COUNT(*)::int c FROM brands WHERE active=TRUE`,
    prisma.$queryRaw`SELECT COUNT(*)::int c FROM campaigns WHERE status='active'`,
    prisma.$queryRaw`SELECT q.name, q.code, COUNT(*)::int scans FROM scans s JOIN qrs q ON q.id=s.qr_id WHERE s.scanned_at >= NOW() - ${days} * INTERVAL '1 day' GROUP BY q.id, q.name, q.code ORDER BY scans DESC LIMIT 10`,
  ]);
  const result = {
    scans: scansRow[0].c, today: todayRow[0].c, qrs: qrsRow[0].c,
    brands: brandsRow[0].c, campaigns: campsRow[0].c, top
  };
  await rSet(cacheKey, result, 30);
  res.json(result);
});

app.get("/api/analytics/timeseries", auth, async (req, res) => {
  await flushScanBuffer();

  const days = Math.min(3650, Math.max(1, Number(req.query.range || 30)));
  const cacheKey = `analytics:timeseries:${days}`;
  const cached = await rGet(cacheKey);
  if (cached) return res.json(cached);

  const rows = await prisma.$queryRaw`
    SELECT DATE(scanned_at) date, COUNT(*)::int scans FROM scans
    WHERE scanned_at >= CURRENT_DATE - ${days} * INTERVAL '1 day'
    GROUP BY DATE(scanned_at) ORDER BY date
  `;
  await rSet(cacheKey, rows, 30);
  res.json(rows);
});

app.get("/api/analytics/breakdown", auth, async (req, res) => {
  await flushScanBuffer();

  const days = Math.min(3650, Math.max(1, Number(req.query.range || 30)));
  const cacheKey = `analytics:breakdown:${days}`;
  const cached = await rGet(cacheKey);
  if (cached) return res.json(cached);

  const group = async (field) => {
    return prisma.$queryRawUnsafe(
      `SELECT COALESCE(${field},'Unknown') label, COUNT(*)::int value FROM scans WHERE scanned_at >= NOW() - $1 * INTERVAL '1 day' GROUP BY ${field} ORDER BY value DESC LIMIT 12`,
      days
    );
  };

  const [browser, os, device, country, city, destination] = await Promise.all([
    group("browser"), group("os"), group("device_type"),
    group("country"), group("city"), group("destination_type")
  ]);
  const result = { browser, os, device, country, city, destination };
  await rSet(cacheKey, result, 30);
  res.json(result);
});

app.get("/api/analytics/export", auth, async (req, res) => {
  await flushScanBuffer();

  const rows = await prisma.$queryRaw`
    SELECT s.scanned_at, q.code AS qr_code, q.name AS qr_name, b.name AS brand_name,
      c.name AS campaign_name, s.country, s.city, s.browser, s.os, s.device, s.device_type,
      s.referrer, d.utm_source, d.utm_medium, d.utm_campaign, d.utm_content, d.utm_term
    FROM scans s
    JOIN qrs q ON s.qr_id = q.id
    JOIN brands b ON q.brand_id = b.id
    JOIN campaigns c ON q.campaign_id = c.id
    JOIN destinations d ON s.destination_id = d.id
    ORDER BY s.scanned_at DESC
  `;
  const headers = ["Scanned At","QR Code","QR Name","Brand","Campaign","Country","City","Browser","OS","Device","Device Type","Referrer","UTM Source","UTM Medium","UTM Campaign","UTM Content","UTM Term"];
  const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = [
    headers.join(","),
    ...rows.map(r => [
      r.scanned_at, r.qr_code, esc(r.qr_name), esc(r.brand_name), esc(r.campaign_name),
      r.country || "", r.city || "", r.browser || "", r.os || "", r.device || "", r.device_type || "",
      esc(r.referrer), r.utm_source || "", r.utm_medium || "", r.utm_campaign || "", r.utm_content || "", r.utm_term || ""
    ].join(","))
  ].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="analytics_export.csv"');
  res.send(csv);
});

// QR redirect ─────────────────────────────────────────────────────────────────
// CRITICAL PATH — must be as fast as possible.
// 1. Check Redis cache (0-1ms)  2. Query Postgres (10-30ms)  3. Buffer scan in Redis
app.get("/qr/:code", async (req, res) => {
  const code = req.params.code;
  const cacheKey = `qr:${code}`;

  // Step 1: Serve from Redis cache if available
  let qrData = await rGet(cacheKey);
  if (!qrData) {
    // Step 2: Query DB — fetch QR, active destination, brand pixels in one go
    const qr = await prisma.qrs.findFirst({
      where: { code, active: true },
      include: {
        destinations: {
          where: { effective_to: null },
          orderBy: { effective_from: "desc" },
          take: 1
        },
        brands: { select: { fb_pixel_id: true, ga_id: true } }
      }
    });
    if (!qr || !qr.destinations.length) return res.status(404).send("QR code is unavailable.");
    const d = qr.destinations[0];
    qrData = {
      qr_id: Number(qr.id),
      dest_id: Number(d.id),
      website_url: d.website_url,
      android_url: d.android_url,
      ios_url: d.ios_url,
      utm_source: d.utm_source, utm_medium: d.utm_medium,
      utm_campaign: d.utm_campaign, utm_content: d.utm_content, utm_term: d.utm_term,
      fb_pixel_id: d.fb_pixel_id || qr.brands?.fb_pixel_id || null,
      ga_id: d.ga_id || qr.brands?.ga_id || null,
    };
    // Cache for 5 minutes — invalidated immediately on PUT /api/qrs/:id
    await rSet(cacheKey, qrData, 300);
  }

  // Step 3: Determine destination URL based on device
  const [type, target] = smart({ active: true }, qrData, req);
  const destination = addUtm(target, qrData);
  const v = visitor(req);

  // Step 4: Buffer scan — non-blocking (fire & forget)
  const scanPayload = {
    qr_id: qrData.qr_id, destination_id: qrData.dest_id,
    ip_hash: v.ip_hash, country: v.country, city: v.city,
    browser: v.browser, browser_version: v.browser_version,
    os: v.os, os_version: v.os_version,
    device: v.device, device_type: v.device_type,
    referrer: v.referrer, user_agent: v.user_agent,
    destination_type: type,
  };
  // If Redis is available, push to buffer; otherwise insert directly
  const bufferedLen = await rPushScan(scanPayload);
  if (bufferedLen) {
    if (bufferedLen >= 100) {
      // Threshold reached! Flush immediately to DB
      flushScanBuffer();
    } else if (process.env.AUTOMATIC_FLUSH !== "true") {
      // Lazy flush (only if background automatic flush is turned off)
      scheduleFlush();
    }
  } else {
    // Redis unavailable — write directly (no data loss)
    prisma.scans.create({
      data: { ...scanPayload, qr_id: BigInt(scanPayload.qr_id), destination_id: BigInt(scanPayload.destination_id) }
    }).catch(e => console.error("[scan-direct]", e.message));
  }

  // Step 5: Respond — tracking page or instant redirect
  const { fb_pixel_id: fbPixel, ga_id: gaId } = qrData;
  if (fbPixel || gaId) {
    res.removeHeader("Content-Security-Policy");
    res.removeHeader("Cross-Origin-Opener-Policy");
    res.removeHeader("Cross-Origin-Resource-Policy");
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8">`;
    html += `<noscript><meta http-equiv="refresh" content="0; url=${destination}"></noscript>`;
    
    if (gaId) {
      html += `\n<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>`;
    }
    if (fbPixel) {
      html += `\n<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${fbPixel}');fbq('track','PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${fbPixel}&ev=PageView&noscript=1"/></noscript>`;
    }
    // Visually completely blank page to avoid user suspicion
    html += `</head><body style="background:#fff;margin:0;padding:0;">`;
    // 50ms timeout gives the pixel network requests time to initiate before navigating away
    html += `<script>setTimeout(function(){window.location.replace('${destination}');},50);</script>`;
    html += `</body></html>`;
    
    return res.send(html);
  }

  // If no pixels are configured, just do an instant 302 redirect
  res.redirect(302, destination);
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  // ⚡ Bind to 0.0.0.0 first so Railway health check can reach us immediately
  await new Promise((resolve) => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Verik QR API on :${PORT} | Prisma ORM | Scan buffer enabled`);
      resolve();
    });
  });

  // Bootstrap runs AFTER server is up — health check won't time out
  try {
    await ensureAdmin();
    await ensureSample();
  } catch (e) {
    console.error("[bootstrap] Warning (non-fatal):", e.message);
  }

  if (process.env.AUTOMATIC_FLUSH === "true") {
    setInterval(flushScanBuffer, FLUSH_MS);
    console.log(`⏱️  Background Automatic Flush Enabled (${FLUSH_MS}ms)`);
  } else {
    console.log(`⏱️  Background Lazy Flush Enabled (Event-driven)`);
  }
}
start().catch(e => { console.error(e); process.exit(1) });
