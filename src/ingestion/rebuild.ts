import { execute } from '../db/query';

const GL_DNT = 'Do Not Tag (COGS/Non-S&M)';
// 2-digit account prefixes whose vendors are always classified as Do Not Tag.
// Must stay in sync with GL_PREFIX_RULES in src/lib/vendorPresets.ts.
const GL_PREFIX_PATTERN = '^(54|55|60)[0-9]';

/**
 * Rebuilds derived tables that depend on raw ingest data.
 * Called after EVERY ingest run (full or source-specific) and during initDb.
 *
 * Steps:
 *   1. Auto-insert vendor_classifications for any new GL-prefix vendor
 *      (financial_rows starting with 54xxx/55xxx/60xxx).  Only affects rows
 *      where manually_set = FALSE, so user overrides are never touched.
 *   2. Create vendor_classification_history for new
 *      (financial_row, entity_name, month_key) tuples.  Uses the resolved
 *      channel from vendor_classifications, falling back to the GL prefix
 *      rule, then 'Unclassified'.  ON CONFLICT DO NOTHING preserves
 *      existing manual overrides.
 *   3. Correct any pre-existing 'Unclassified' history entries under
 *      GL-prefix rows (written before step 1 existed).
 */
export async function rebuildDerivedTables(): Promise<void> {
  // ── Step 1: Upsert vendor_classifications for GL-prefix vendors ──────────
  // New vendors that appear for the first time under a 54/55/60xxx account
  // are immediately classified.  Existing manual overrides (manually_set=TRUE)
  // are skipped by the WHERE clause.
  await execute(
    `INSERT INTO vendor_classifications
       (financial_row, entity_name, channel, is_preset, manually_set, updated_at)
     SELECT DISTINCT financial_row, entity_name, $1, TRUE, FALSE, NOW()
     FROM netsuite_actuals
     WHERE financial_row ~ $2
     ON CONFLICT (financial_row, entity_name) DO UPDATE
       SET channel    = EXCLUDED.channel,
           is_preset  = TRUE,
           updated_at = NOW()
     WHERE vendor_classifications.manually_set = FALSE`,
    [GL_DNT, GL_PREFIX_PATTERN]
  );

  // ── Step 2: Backfill history for new (fr, entity, month) combos ──────────
  // For each new actuals row that has no history entry yet, write the
  // current vendor_classifications channel (now guaranteed to be correct
  // for GL-prefix vendors after step 1).  Falls back to the GL prefix
  // rule, then 'Unclassified', for safety.
  await execute(
    `INSERT INTO vendor_classification_history
       (financial_row, entity_name, channel, month_key, is_preset, manually_set)
     SELECT DISTINCT
       n.financial_row,
       n.entity_name,
       COALESCE(
         vc.channel,
         CASE WHEN n.financial_row ~ $2 THEN $1 ELSE 'Unclassified' END
       ) AS channel,
       n.month_key,
       COALESCE(vc.is_preset, n.financial_row ~ $2),
       FALSE
     FROM netsuite_actuals n
     LEFT JOIN vendor_classifications vc
            ON vc.financial_row = n.financial_row
           AND vc.entity_name   = n.entity_name
     WHERE n.month_key IS NOT NULL
     ON CONFLICT (financial_row, entity_name, month_key) DO NOTHING`,
    [GL_DNT, GL_PREFIX_PATTERN]
  );

  // ── Step 3: Correct stale 'Unclassified' entries under GL-prefix rows ────
  // Rows written before step 1 existed may still hold 'Unclassified'.
  // Fix them now unless the user has manually set a different channel.
  await execute(
    `UPDATE vendor_classification_history
        SET channel   = $1,
            is_preset = TRUE
      WHERE financial_row ~ $2
        AND channel      = 'Unclassified'
        AND manually_set = FALSE`,
    [GL_DNT, GL_PREFIX_PATTERN]
  );

  // ── Step 4: Prune stale classification history ────────────────────────────
  // When a file is re-ingested with fewer rows (e.g. a vendor was removed),
  // netsuite_actuals rows are deleted first but old history entries survive.
  // Remove any history entry that has no matching actuals row and was not
  // manually set by a user — manual overrides are intentionally kept.
  await execute(
    `DELETE FROM vendor_classification_history vch
     WHERE manually_set = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM netsuite_actuals n
         WHERE n.financial_row = vch.financial_row
           AND n.entity_name   = vch.entity_name
           AND n.month_key     = vch.month_key
       )`
  );

  console.log('[rebuild] vendor_classification_history backfill complete');
}
