-- Marketing Dashboard — database schema reference
-- Authoritative runtime copy lives in src/db/init.ts (initDb function).
-- All monetary values stored as BIGINT cents. Never DECIMAL or FLOAT.

-- ============================================================
-- NETSUITE ACTUALS  (replaces marketing_spend)
-- ============================================================

CREATE TABLE IF NOT EXISTS netsuite_actuals (
  id             SERIAL PRIMARY KEY,
  source         TEXT NOT NULL DEFAULT 'netsuite',
  month_key      TEXT NOT NULL,           -- 'YYYY-MM' derived from filename
  financial_row  TEXT NOT NULL,           -- e.g. "43004 - eStatement Submissions"
  entity_name    TEXT NOT NULL,           -- e.g. "25517 Solution Reach"
  amount         BIGINT NOT NULL DEFAULT 0, -- cents
  ingested_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (month_key, financial_row, entity_name)
);

-- ============================================================
-- SALESFORCE LEADS
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_leads (
  id                     SERIAL PRIMARY KEY,
  source                 TEXT NOT NULL,           -- 'salesforce'
  channel                TEXT NOT NULL,
  campaign_name          TEXT NOT NULL DEFAULT '', -- '' when no campaign
  month_key              TEXT NOT NULL,           -- 'YYYY-MM'
  leads_generated        INTEGER DEFAULT 0,
  leads_qualified        INTEGER DEFAULT 0,
  opportunities_created  INTEGER DEFAULT 0,
  closed_won             INTEGER DEFAULT 0,
  pipeline_value         BIGINT DEFAULT 0,        -- cents
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, channel, campaign_name, month_key)
);

-- ============================================================
-- INGESTION TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS ingested_files (
  file_path    TEXT PRIMARY KEY,
  file_hash    TEXT,
  ingested_at  TIMESTAMPTZ DEFAULT NOW(),
  row_count    INTEGER,
  source_name  TEXT
);

-- ============================================================
-- AUTH TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id    TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT DEFAULT 'viewer',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id      TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  status        TEXT DEFAULT 'pending',
  requested_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_clerk_id   TEXT NOT NULL,
  action           TEXT NOT NULL,
  target_clerk_id  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_netsuite_month         ON netsuite_actuals(month_key);
CREATE INDEX IF NOT EXISTS idx_netsuite_financial_row ON netsuite_actuals(financial_row);
CREATE INDEX IF NOT EXISTS idx_netsuite_entity        ON netsuite_actuals(entity_name);
CREATE INDEX IF NOT EXISTS idx_leads_month            ON marketing_leads(month_key);
CREATE INDEX IF NOT EXISTS idx_leads_channel          ON marketing_leads(channel);
