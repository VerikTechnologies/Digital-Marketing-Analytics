-- ============================================================
-- Verik Universal QR — PostgreSQL Schema (Supabase)
-- Run this once in the Supabase SQL Editor to set up all tables.
-- admin_users table is NOT needed — Supabase Auth manages users.
-- ============================================================

-- Reusable trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  slug        VARCHAR(120) NOT NULL UNIQUE,
  website_url TEXT,
  logo_url    TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brands_created ON brands (created_at DESC);
DROP TRIGGER IF EXISTS brands_updated_at ON brands;
CREATE TRIGGER brands_updated_at
  BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id      BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  slug          VARCHAR(150) NOT NULL,
  campaign_type VARCHAR(100) DEFAULT '',
  start_date    DATE,
  end_date      DATE,
  budget        DECIMAL(12,2),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('draft','active','paused','completed','archived')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns (status);
CREATE INDEX IF NOT EXISTS idx_campaign_dates  ON campaigns (start_date, end_date);
DROP TRIGGER IF EXISTS campaigns_updated_at ON campaigns;
CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- QRs
CREATE TABLE IF NOT EXISTS qrs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id    BIGINT NOT NULL REFERENCES brands(id)    ON DELETE RESTRICT,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(100) NOT NULL UNIQUE,
  channel     VARCHAR(100) DEFAULT '',
  location    VARCHAR(150) DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qr_campaign ON qrs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_qr_brand    ON qrs (brand_id);
CREATE INDEX IF NOT EXISTS idx_qr_active   ON qrs (active);
DROP TRIGGER IF EXISTS qrs_updated_at ON qrs;
CREATE TRIGGER qrs_updated_at
  BEFORE UPDATE ON qrs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Destinations (URL history per QR)
CREATE TABLE IF NOT EXISTS destinations (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  qr_id          BIGINT NOT NULL REFERENCES qrs(id) ON DELETE CASCADE,
  website_url    TEXT NOT NULL,
  android_url    TEXT,
  ios_url        TEXT,
  utm_source     VARCHAR(150) DEFAULT '',
  utm_medium     VARCHAR(150) DEFAULT '',
  utm_campaign   VARCHAR(150) DEFAULT '',
  utm_content    VARCHAR(150) DEFAULT '',
  utm_term       VARCHAR(150) DEFAULT '',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_destination_qr ON destinations (qr_id, effective_from, effective_to);

-- Scans
CREATE TABLE IF NOT EXISTS scans (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  qr_id            BIGINT NOT NULL REFERENCES qrs(id) ON DELETE CASCADE,
  destination_id   BIGINT REFERENCES destinations(id) ON DELETE SET NULL,
  scanned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          CHAR(64),
  country          VARCHAR(100),
  city             VARCHAR(100),
  browser          VARCHAR(100),
  browser_version  VARCHAR(50),
  os               VARCHAR(100),
  os_version       VARCHAR(50),
  device           VARCHAR(100),
  device_type      VARCHAR(30),
  referrer         TEXT,
  user_agent       TEXT,
  destination_type VARCHAR(20) NOT NULL DEFAULT 'website'
);
CREATE INDEX IF NOT EXISTS idx_scan_date    ON scans (scanned_at);
CREATE INDEX IF NOT EXISTS idx_scan_qr_date ON scans (qr_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_scan_country ON scans (country);
CREATE INDEX IF NOT EXISTS idx_scan_city    ON scans (city);

-- Audit logs (admin_user_id is Supabase Auth UUID)
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id UUID,
  action        VARCHAR(100) NOT NULL,
  entity_type   VARCHAR(100) NOT NULL,
  entity_id     BIGINT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);

-- Seed: Joeyrooms brand
INSERT INTO brands (name, slug, website_url, active)
SELECT 'Joeyrooms', 'joeyrooms', 'https://joeyrooms.com/', TRUE
WHERE NOT EXISTS (SELECT 1 FROM brands WHERE slug = 'joeyrooms');
