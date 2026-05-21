import { execute } from '../db/query';

/**
 * Rebuilds derived tables that depend on raw ingest data.
 * Called after every ingest run and during initDb.
 *
 * Currently: backfills vendor_classification_history for any new
 * (financial_row, entity_name, month_key) tuples added by the latest ingest.
 * Uses ON CONFLICT DO NOTHING so existing records (including manual overrides)
 * are never touched.
 */
export async function rebuildDerivedTables(): Promise<void> {
  await execute(`
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
    ON CONFLICT (financial_row, entity_name, month_key) DO NOTHING
  `);

  console.log('[rebuild] vendor_classification_history backfill complete');
}
