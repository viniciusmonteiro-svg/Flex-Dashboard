import { execute } from '@/db/query';
import type { NetsuiteRow, MarketingLeadsRow, SalesforceRow, FileRecord } from './types';

// ─── Batch helpers ────────────────────────────────────────────────────────────

/**
 * Build a multi-row VALUES clause and flat params array for a batch INSERT.
 *
 * @param rows     Array of data rows
 * @param cols     Number of columns per row
 * @param toParams Function that maps a row to its ordered param array
 */
function buildBatch<T>(
  rows: T[],
  cols: number,
  toParams: (row: T) => unknown[]
): { values: string; params: unknown[] } {
  const params: unknown[] = [];
  const placeholders: string[] = [];

  for (const row of rows) {
    const rowParams = toParams(row);
    const start = params.length + 1;
    placeholders.push(
      '(' + rowParams.map((_, i) => `$${start + i}`).join(', ') + ')'
    );
    params.push(...rowParams);
  }

  return { values: placeholders.join(',\n'), params };
}

async function runBatches<T>(
  rows: T[],
  batchSize: number,
  cols: number,
  toParams: (row: T) => unknown[],
  buildSql: (values: string) => string
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { values, params } = buildBatch(batch, cols, toParams);
    await execute(buildSql(values), params);
  }
}

// ─── Upsert functions ─────────────────────────────────────────────────────────

/**
 * Pre-aggregate NetSuite rows before inserting.
 *
 * The same vendor can appear multiple times in one file (separate transactions
 * for the same month/GL row/entity that NetSuite exports as individual lines).
 * Inserting them individually would trigger
 *   "ON CONFLICT DO UPDATE command cannot affect row a second time"
 * because two rows in the same batch share the same unique key
 * (month_key, financial_row, entity_name).
 *
 * Strategy: group by key, SUM amounts, keep last non-null scalar fields.
 */
function aggregateNetsuiteRows(rows: NetsuiteRow[]): NetsuiteRow[] {
  const map = new Map<string, NetsuiteRow>();

  for (const row of rows) {
    // Key includes tx_month so that cross-period entries (e.g. Sep 30 expense
    // inside the Oct accounting file) are kept as a separate DB row from the
    // same vendor's October transactions, enabling correct Transaction Date filtering.
    const key = `${row.month_key}|${row.financial_row}|${row.entity_name}|${row.tx_month}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
    } else {
      existing.amount += row.amount;
      // has_name: true if ANY row in the group had a real name
      if (row.has_name) existing.has_name = true;
      // Keep last non-null value for metadata fields
      if (row.transaction_date  != null) existing.transaction_date  = row.transaction_date;
      if (row.accounting_period != null) existing.accounting_period = row.accounting_period;
      if (row.description       != null) existing.description       = row.description;
    }
  }

  return [...map.values()];
}

// 10 columns per row → batch 450 rows = 4 500 params (well under the 65 535 limit)
export async function upsertNetsuiteActuals(rows: NetsuiteRow[]): Promise<void> {
  const deduped = aggregateNetsuiteRows(rows);
  await runBatches(
    deduped,
    450,
    10,
    (r) => [
      r.source, r.month_key, r.financial_row, r.entity_name, r.has_name,
      r.tx_month,
      r.amount,
      r.transaction_date  ?? null,
      r.accounting_period ?? null,
      r.description       ?? null,
    ],
    (values) => `
      INSERT INTO netsuite_actuals
        (source, month_key, financial_row, entity_name, has_name,
         tx_month, amount, transaction_date, accounting_period, description)
      VALUES ${values}
      ON CONFLICT ON CONSTRAINT netsuite_actuals_unique_tx DO UPDATE SET
        has_name          = EXCLUDED.has_name,
        amount            = EXCLUDED.amount,
        accounting_period = EXCLUDED.accounting_period,
        description       = EXCLUDED.description,
        ingested_at       = NOW()`
  );
}

// 9 columns per row → batch 500 rows = 4 500 params
export async function upsertLeads(rows: MarketingLeadsRow[]): Promise<void> {
  await runBatches(
    rows,
    500,
    9,
    (r) => [
      r.source, r.channel, r.campaign_name, r.month_key,
      r.leads_generated, r.leads_qualified, r.opportunities_created,
      r.closed_won, r.pipeline_value,
    ],
    (values) => `
      INSERT INTO marketing_leads
        (source, channel, campaign_name, month_key, leads_generated, leads_qualified,
         opportunities_created, closed_won, pipeline_value)
      VALUES ${values}
      ON CONFLICT (source, channel, campaign_name, month_key) DO UPDATE SET
        leads_generated       = EXCLUDED.leads_generated,
        leads_qualified       = EXCLUDED.leads_qualified,
        opportunities_created = EXCLUDED.opportunities_created,
        closed_won            = EXCLUDED.closed_won,
        pipeline_value        = EXCLUDED.pipeline_value`
  );
}

/**
 * Deduplicate Salesforce rows by opportunity_id.
 * When Opportunity ID is absent the parser falls back to Opportunity Name, so
 * duplicate names in the source file produce the same key. Keep the last occurrence.
 */
function aggregateSalesforceRows(rows: SalesforceRow[]): SalesforceRow[] {
  const map = new Map<string, SalesforceRow>();
  for (const row of rows) {
    map.set(row.opportunity_id, row);
  }
  return [...map.values()];
}

// 17 columns per row → batch 250 rows = 4 250 params (well under the 65 535 limit)
export async function upsertOpportunities(rows: SalesforceRow[]): Promise<void> {
  const deduped = aggregateSalesforceRows(rows);
  await runBatches(
    deduped,
    250,
    17,
    (r) => [
      r.opportunity_id, r.opportunity_name, r.account_name,
      r.created_date, r.close_date, r.stage, r.monthly_mrr,
      r.number_of_locations, r.primary_channel, r.primary_campaign_source,
      r.lead_source, r.opportunity_owner, r.opp_type, r.created_month,
      r.demoed, r.order_type, r.primary_campaign_name ?? null,
    ],
    (values) => `
      INSERT INTO salesforce_opportunities
        (opportunity_id, opportunity_name, account_name, created_date, close_date,
         stage, monthly_mrr, number_of_locations, primary_channel,
         primary_campaign_source, lead_source, opportunity_owner, opp_type,
         created_month, demoed, order_type, primary_campaign_name)
      VALUES ${values}
      ON CONFLICT (opportunity_id) DO UPDATE SET
        opportunity_name        = EXCLUDED.opportunity_name,
        account_name            = EXCLUDED.account_name,
        created_date            = EXCLUDED.created_date,
        created_month           = EXCLUDED.created_month,
        stage                   = EXCLUDED.stage,
        close_date              = EXCLUDED.close_date,
        monthly_mrr             = EXCLUDED.monthly_mrr,
        primary_channel         = EXCLUDED.primary_channel,
        primary_campaign_source = EXCLUDED.primary_campaign_source,
        primary_campaign_name   = EXCLUDED.primary_campaign_name,
        lead_source             = EXCLUDED.lead_source,
        opportunity_owner       = EXCLUDED.opportunity_owner,
        opp_type                = EXCLUDED.opp_type,
        number_of_locations     = EXCLUDED.number_of_locations,
        demoed                  = EXCLUDED.demoed,
        order_type              = EXCLUDED.order_type,
        ingested_at             = NOW()`
  );
}

// ─── Delete helpers ──────────────────────────────────────────────────────────

/**
 * Delete all netsuite_actuals rows for a given month_key.
 * Called before re-inserting rows from an updated file so that vendors
 * removed from the source file are not left as stale DB rows.
 */
export async function deleteNetsuiteActualsByMonth(monthKey: string): Promise<void> {
  if (!monthKey) return;
  await execute(
    `DELETE FROM netsuite_actuals WHERE month_key = $1 AND source = 'netsuite'`,
    [monthKey]
  );
}

// ─── Ingested-files tracker ───────────────────────────────────────────────────

export async function upsertIngestedFile(record: FileRecord): Promise<void> {
  await execute(
    `INSERT INTO ingested_files
       (file_path, file_name, source_type, parent_folder,
        file_size_bytes, file_mtime, row_count, ingested_at, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
     ON CONFLICT (file_path) DO UPDATE SET
       file_name       = EXCLUDED.file_name,
       source_type     = EXCLUDED.source_type,
       parent_folder   = EXCLUDED.parent_folder,
       file_size_bytes = EXCLUDED.file_size_bytes,
       file_mtime      = EXCLUDED.file_mtime,
       row_count       = EXCLUDED.row_count,
       ingested_at     = NOW(),
       status          = EXCLUDED.status,
       notes           = EXCLUDED.notes`,
    [
      record.file_path, record.file_name, record.source_type, record.parent_folder,
      record.file_size_bytes, record.file_mtime, record.row_count,
      record.status, record.notes ?? null,
    ]
  );
}
