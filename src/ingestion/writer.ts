import { execute } from '@/db/query';
import type { NetsuiteRow, MarketingLeadsRow, SalesforceRow, FileRecord } from './types';

export async function upsertNetsuiteActuals(rows: NetsuiteRow[]): Promise<void> {
  for (const row of rows) {
    await execute(
      `INSERT INTO netsuite_actuals
         (source, month_key, financial_row, entity_name, amount)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (month_key, financial_row, entity_name) DO UPDATE SET
         amount      = EXCLUDED.amount,
         ingested_at = NOW()`,
      [row.source, row.month_key, row.financial_row, row.entity_name, row.amount]
    );
  }
}

export async function upsertLeads(rows: MarketingLeadsRow[]): Promise<void> {
  for (const row of rows) {
    await execute(
      `INSERT INTO marketing_leads
         (source, channel, campaign_name, month_key, leads_generated, leads_qualified,
          opportunities_created, closed_won, pipeline_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source, channel, campaign_name, month_key) DO UPDATE SET
         leads_generated       = EXCLUDED.leads_generated,
         leads_qualified       = EXCLUDED.leads_qualified,
         opportunities_created = EXCLUDED.opportunities_created,
         closed_won            = EXCLUDED.closed_won,
         pipeline_value        = EXCLUDED.pipeline_value`,
      [
        row.source, row.channel, row.campaign_name, row.month_key,
        row.leads_generated, row.leads_qualified, row.opportunities_created,
        row.closed_won, row.pipeline_value,
      ]
    );
  }
}

export async function upsertOpportunities(rows: SalesforceRow[]): Promise<void> {
  for (const row of rows) {
    await execute(
      `INSERT INTO salesforce_opportunities
         (opportunity_id, opportunity_name, account_name, created_date, close_date,
          stage, monthly_mrr, number_of_locations, primary_channel,
          primary_campaign_source, lead_source, opportunity_owner, opp_type,
          created_month, ingested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (opportunity_id) DO UPDATE SET
         stage                   = EXCLUDED.stage,
         close_date              = EXCLUDED.close_date,
         monthly_mrr             = EXCLUDED.monthly_mrr,
         primary_channel         = EXCLUDED.primary_channel,
         primary_campaign_source = EXCLUDED.primary_campaign_source,
         ingested_at             = NOW()`,
      [
        row.opportunity_id, row.opportunity_name, row.account_name,
        row.created_date, row.close_date, row.stage, row.monthly_mrr,
        row.number_of_locations, row.primary_channel, row.primary_campaign_source,
        row.lead_source, row.opportunity_owner, row.opp_type, row.created_month,
      ]
    );
  }
}

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
