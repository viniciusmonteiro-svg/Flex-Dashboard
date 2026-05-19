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

// 5 columns per row → batch 1 000 rows = 5 000 params (well under the 65 535 limit)
export async function upsertNetsuiteActuals(rows: NetsuiteRow[]): Promise<void> {
  await runBatches(
    rows,
    1000,
    5,
    (r) => [r.source, r.month_key, r.financial_row, r.entity_name, r.amount],
    (values) => `
      INSERT INTO netsuite_actuals
        (source, month_key, financial_row, entity_name, amount)
      VALUES ${values}
      ON CONFLICT (month_key, financial_row, entity_name) DO UPDATE SET
        amount      = EXCLUDED.amount,
        ingested_at = NOW()`
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

// 14 columns per row → batch 400 rows = 5 600 params
export async function upsertOpportunities(rows: SalesforceRow[]): Promise<void> {
  await runBatches(
    rows,
    400,
    14,
    (r) => [
      r.opportunity_id, r.opportunity_name, r.account_name,
      r.created_date, r.close_date, r.stage, r.monthly_mrr,
      r.number_of_locations, r.primary_channel, r.primary_campaign_source,
      r.lead_source, r.opportunity_owner, r.opp_type, r.created_month,
    ],
    (values) => `
      INSERT INTO salesforce_opportunities
        (opportunity_id, opportunity_name, account_name, created_date, close_date,
         stage, monthly_mrr, number_of_locations, primary_channel,
         primary_campaign_source, lead_source, opportunity_owner, opp_type,
         created_month, ingested_at)
      VALUES ${values}
      ON CONFLICT (opportunity_id) DO UPDATE SET
        stage                   = EXCLUDED.stage,
        close_date              = EXCLUDED.close_date,
        monthly_mrr             = EXCLUDED.monthly_mrr,
        primary_channel         = EXCLUDED.primary_channel,
        primary_campaign_source = EXCLUDED.primary_campaign_source,
        ingested_at             = NOW()`
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
