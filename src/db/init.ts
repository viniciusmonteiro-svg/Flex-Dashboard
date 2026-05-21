import { withConnection } from './connection';

const DDL = `
CREATE TABLE IF NOT EXISTS netsuite_actuals (
  id             SERIAL PRIMARY KEY,
  source         TEXT NOT NULL DEFAULT 'netsuite',
  month_key      TEXT NOT NULL,
  financial_row  TEXT NOT NULL,
  entity_name    TEXT NOT NULL,
  amount         BIGINT NOT NULL DEFAULT 0,
  ingested_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (month_key, financial_row, entity_name)
);

CREATE TABLE IF NOT EXISTS marketing_leads (
  id                     SERIAL PRIMARY KEY,
  source                 TEXT NOT NULL,
  channel                TEXT NOT NULL,
  campaign_name          TEXT NOT NULL DEFAULT '',
  month_key              TEXT NOT NULL,
  leads_generated        INTEGER DEFAULT 0,
  leads_qualified        INTEGER DEFAULT 0,
  opportunities_created  INTEGER DEFAULT 0,
  closed_won             INTEGER DEFAULT 0,
  pipeline_value         BIGINT DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, channel, campaign_name, month_key)
);

CREATE TABLE IF NOT EXISTS ingested_files (
  file_path        TEXT PRIMARY KEY,
  file_name        TEXT,
  source_type      TEXT,
  parent_folder    TEXT,
  file_size_bytes  BIGINT,
  file_mtime       TIMESTAMPTZ,
  row_count        INTEGER,
  ingested_at      TIMESTAMPTZ DEFAULT NOW(),
  status           TEXT        DEFAULT 'ok',
  notes            TEXT
);

-- Migration: add new columns introduced by the CurveMonthlyMarketingReport format
ALTER TABLE netsuite_actuals ADD COLUMN IF NOT EXISTS transaction_date   DATE;
ALTER TABLE netsuite_actuals ADD COLUMN IF NOT EXISTS accounting_period  TEXT;
ALTER TABLE netsuite_actuals ADD COLUMN IF NOT EXISTS description        TEXT;

-- Migration: upgrade existing installs with old ingested_files schema
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS file_name       TEXT;
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS source_type     TEXT;
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS parent_folder   TEXT;
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS file_mtime      TIMESTAMPTZ;
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'ok';
ALTER TABLE ingested_files ADD COLUMN IF NOT EXISTS notes           TEXT;

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

CREATE TABLE IF NOT EXISTS vendor_classifications (
  id            SERIAL PRIMARY KEY,
  financial_row TEXT NOT NULL DEFAULT '',
  entity_name   TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'Unclassified',
  is_preset     BOOLEAN NOT NULL DEFAULT FALSE,
  manually_set  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (financial_row, entity_name)
);

-- Idempotent migration for existing installs with old single-column unique constraint
ALTER TABLE vendor_classifications ADD COLUMN IF NOT EXISTS financial_row TEXT NOT NULL DEFAULT '';
DO $mig$
BEGIN
  -- Drop old single-column unique index/constraint if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_classifications_entity_name_key'
      AND conrelid = 'vendor_classifications'::regclass
  ) THEN
    ALTER TABLE vendor_classifications DROP CONSTRAINT vendor_classifications_entity_name_key;
  END IF;
  -- Add compound unique constraint if not present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_classifications_financial_row_entity_name_key'
      AND conrelid = 'vendor_classifications'::regclass
  ) THEN
    ALTER TABLE vendor_classifications
      ADD CONSTRAINT vendor_classifications_financial_row_entity_name_key
      UNIQUE (financial_row, entity_name);
  END IF;
END
$mig$;

CREATE TABLE IF NOT EXISTS salesforce_opportunities (
  id                       SERIAL PRIMARY KEY,
  opportunity_id           TEXT UNIQUE,
  opportunity_name         TEXT,
  account_name             TEXT,
  created_date             DATE,
  close_date               DATE,
  stage                    TEXT,
  monthly_mrr              BIGINT DEFAULT 0,
  number_of_locations      INTEGER DEFAULT 0,
  primary_channel          TEXT,
  primary_campaign_source  TEXT,
  lead_source              TEXT,
  opportunity_owner        TEXT,
  opp_type                 TEXT,
  created_month            TEXT,
  ingested_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_classification_history (
  id             SERIAL PRIMARY KEY,
  financial_row  TEXT NOT NULL,
  entity_name    TEXT NOT NULL,
  channel        TEXT NOT NULL,
  month_key      TEXT NOT NULL,
  is_preset      BOOLEAN DEFAULT FALSE,
  manually_set   BOOLEAN DEFAULT FALSE,
  set_by         TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (financial_row, entity_name, month_key)
);

CREATE INDEX IF NOT EXISTS idx_netsuite_month         ON netsuite_actuals(month_key);
CREATE INDEX IF NOT EXISTS idx_netsuite_financial_row ON netsuite_actuals(financial_row);
CREATE INDEX IF NOT EXISTS idx_netsuite_entity        ON netsuite_actuals(entity_name);
CREATE INDEX IF NOT EXISTS idx_leads_month            ON marketing_leads(month_key);
CREATE INDEX IF NOT EXISTS idx_leads_channel          ON marketing_leads(channel);
CREATE INDEX IF NOT EXISTS idx_vendor_class_entity    ON vendor_classifications(entity_name);
CREATE INDEX IF NOT EXISTS idx_vendor_class_channel   ON vendor_classifications(channel);
CREATE INDEX IF NOT EXISTS idx_sf_created_month       ON salesforce_opportunities(created_month);
CREATE INDEX IF NOT EXISTS idx_sf_channel             ON salesforce_opportunities(primary_channel);
CREATE INDEX IF NOT EXISTS idx_sf_stage               ON salesforce_opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_vc_history_month             ON vendor_classification_history(month_key);
CREATE INDEX IF NOT EXISTS idx_vc_history_entity            ON vendor_classification_history(financial_row, entity_name);
CREATE INDEX IF NOT EXISTS idx_netsuite_accounting_period   ON netsuite_actuals(accounting_period);
CREATE INDEX IF NOT EXISTS idx_netsuite_transaction_date    ON netsuite_actuals(transaction_date);

-- Backfill vendor_classification_history from current vendor_classifications.
-- Idempotent: ON CONFLICT DO NOTHING skips rows that already exist.
-- Uses LEFT JOIN so vendors with no classification row still get an
-- 'Unclassified' history entry (INNER JOIN would silently exclude them).
INSERT INTO vendor_classification_history
  (financial_row, entity_name, channel, month_key, is_preset, manually_set)
SELECT DISTINCT
  n.financial_row,
  n.entity_name,
  COALESCE(vc.channel, 'Unclassified') AS channel,
  n.month_key,
  COALESCE(vc.is_preset, FALSE),
  FALSE
FROM netsuite_actuals n
LEFT JOIN vendor_classifications vc
  ON vc.financial_row = n.financial_row
 AND vc.entity_name   = n.entity_name
WHERE n.month_key IS NOT NULL
ON CONFLICT (financial_row, entity_name, month_key) DO NOTHING;
`;

let initialized = false;

export async function initDb(): Promise<void> {
  if (initialized) return;
  await withConnection((client) => client.query(DDL));
  initialized = true;
}
