import pkg from 'pg';
const { Client } = pkg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // 1. Does 2026-04 actually exist in netsuite_actuals?
  const apr = await client.query(`
    SELECT COUNT(*) AS row_count
    FROM netsuite_actuals
    WHERE month_key = '2026-04'
  `);
  console.log('netsuite_actuals rows with month_key=2026-04:', apr.rows[0].row_count);

  // 2. Are there history entries for 2026-04 with no matching actuals?
  const orphanHistory = await client.query(`
    SELECT vch.financial_row, vch.entity_name, vch.channel, vch.month_key
    FROM vendor_classification_history vch
    WHERE vch.month_key = '2026-04'
      AND NOT EXISTS (
        SELECT 1 FROM netsuite_actuals n
        WHERE n.financial_row = vch.financial_row
          AND n.entity_name   = vch.entity_name
          AND n.month_key     = '2026-04'
      )
    LIMIT 10
  `);
  console.log('\nHistory entries for 2026-04 with NO matching netsuite_actuals:');
  console.table(orphanHistory.rows);

  // 3. History entries ONLY — no actuals at all (orphaned months)
  const orphanMonths = await client.query(`
    SELECT DISTINCT month_key
    FROM vendor_classification_history
    WHERE month_key NOT IN (SELECT DISTINCT month_key FROM netsuite_actuals)
    ORDER BY month_key
  `);
  console.log('\nMonths in vendor_classification_history with NO actuals data:',
    orphanMonths.rows.map(r => r.month_key).join(', ') || 'none');

  // 4. What about new vendors — scenario simulation:
  //    If a NEW vendor "Bing Ads" under 70551 were ingested for 2026-05,
  //    what would rebuildDerivedTables write for its channel?
  const newVendorCheck = await client.query(`
    SELECT channel FROM vendor_classifications
    WHERE financial_row = '70551 - Advertising - Electronic'
      AND entity_name = 'Bing Ads'
  `);
  console.log('\nHypothetical new vendor "Bing Ads" in vendor_classifications:',
    newVendorCheck.rows.length === 0 ? 'NOT FOUND (would get Unclassified in history)' : newVendorCheck.rows[0].channel);

  // 5. New GL-prefix vendor scenario — simulate what rebuild would write
  const glNewVendorCheck = await client.query(`
    SELECT channel FROM vendor_classifications
    WHERE financial_row = '60200 - Benefits Program'
      AND entity_name = 'New Benefits Vendor XYZ'
  `);
  console.log('Hypothetical "New Benefits Vendor XYZ" under 60200 in vendor_classifications:',
    glNewVendorCheck.rows.length === 0 ? 'NOT FOUND (would get Unclassified, should be Do Not Tag)' : glNewVendorCheck.rows[0].channel);

  // 6. How many vendor_classifications entries exist vs distinct pairs in netsuite_actuals?
  const vcCount = await client.query('SELECT COUNT(*) AS cnt FROM vendor_classifications');
  const pairsCount = await client.query('SELECT COUNT(*) AS cnt FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) x');
  console.log(`\nvendor_classifications rows: ${vcCount.rows[0].cnt}`);
  console.log(`Distinct (financial_row, entity_name) in netsuite_actuals: ${pairsCount.rows[0].cnt}`);

  // 7. Pairs in netsuite_actuals that have NO vendor_classifications entry (unclassified in vc)
  const unclassifiedPairs = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) n
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_classifications vc
      WHERE vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    )
  `);
  console.log(`Pairs in actuals with NO vendor_classifications entry: ${unclassifiedPairs.rows[0].cnt}`);

  // 8. Of those unclassified pairs: how many are under GL-prefix rows (should be auto-classified)?
  const unclassifiedGl = await client.query(`
    SELECT DISTINCT n.financial_row, n.entity_name
    FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) n
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_classifications vc
      WHERE vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    )
      AND n.financial_row ~ '^(54|55|60)[0-9]'
    ORDER BY n.financial_row, n.entity_name
    LIMIT 20
  `);
  console.log(`\nUnclassified pairs under GL-prefix rows (54/55/60xxx) — sample:`);
  console.table(unclassifiedGl.rows);

  await client.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
