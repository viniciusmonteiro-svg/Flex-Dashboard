/**
 * Manually runs rebuildDerivedTables() against the live DB.
 * Mirrors the logic in src/ingestion/rebuild.ts exactly.
 */
import pkg from 'pg';
const { Client } = pkg;

const GL_DNT = 'Do Not Tag (COGS/Non-S&M)';
const GL_PREFIX_PATTERN = '^(54|55|60)[0-9]';

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  console.log('Connected.\n');

  // ── Step 1 ───────────────────────────────────────────────────────────────
  const s1 = await client.query(
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
  console.log('Step 1 — vendor_classifications GL upsert, rows affected:', s1.rowCount);

  // ── Step 2 ───────────────────────────────────────────────────────────────
  const s2 = await client.query(
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
  console.log('Step 2 — history backfill (new rows only), rows inserted:', s2.rowCount);

  // ── Step 3 ───────────────────────────────────────────────────────────────
  const s3 = await client.query(
    `UPDATE vendor_classification_history
        SET channel   = $1,
            is_preset = TRUE
      WHERE financial_row ~ $2
        AND channel      = 'Unclassified'
        AND manually_set = FALSE`,
    [GL_DNT, GL_PREFIX_PATTERN]
  );
  console.log('Step 3 — stale Unclassified GL history entries corrected:', s3.rowCount);

  // ── Post-run audit ────────────────────────────────────────────────────────
  console.log('\n── Post-run checks ─────────────────────────────────────────\n');

  const missing = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT DISTINCT n.financial_row, n.entity_name, n.month_key
      FROM netsuite_actuals n
      WHERE NOT EXISTS (
        SELECT 1 FROM vendor_classification_history vch
        WHERE vch.financial_row = n.financial_row
          AND vch.entity_name   = n.entity_name
          AND vch.month_key     = n.month_key
      )
    ) x
  `);
  console.log('Actuals combos still missing history entry (should be 0):', missing.rows[0].cnt);

  const glUnclassified = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM vendor_classification_history
    WHERE financial_row ~ $1
      AND channel = 'Unclassified'
      AND manually_set = FALSE
  `, [GL_PREFIX_PATTERN]);
  console.log('GL-prefix history entries still Unclassified (should be 0):', glUnclassified.rows[0].cnt);

  const unclassifiedPairs = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) n
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_classifications vc
      WHERE vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    )
  `);
  console.log('Pairs in actuals with no vendor_classifications entry:', unclassifiedPairs.rows[0].cnt,
    '(these are legitimate unclassified vendors — not GL rows)');

  // Verify GL-prefix vc coverage
  const glVcBreakdown = await client.query(`
    SELECT LEFT(financial_row, 5) as prefix, channel, COUNT(*) AS count
    FROM vendor_classifications
    WHERE financial_row ~ $1
    GROUP BY prefix, channel
    ORDER BY prefix
  `, [GL_PREFIX_PATTERN]);
  console.log('\nGL-prefix vendor_classifications breakdown:');
  console.table(glVcBreakdown.rows);

  await client.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
