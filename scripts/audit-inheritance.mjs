import pkg from 'pg';
const { Client } = pkg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // 1. Months present in netsuite_actuals
  const months = await client.query(
    'SELECT DISTINCT month_key FROM netsuite_actuals ORDER BY month_key'
  );
  console.log('Months in netsuite_actuals:', months.rows.map((r) => r.month_key).join(', '));

  // 2. vendor_classifications entry for Google Ads
  const vc = await client.query(`
    SELECT financial_row, entity_name, channel, is_preset, manually_set
    FROM vendor_classifications
    WHERE entity_name = 'Google Ads'
    LIMIT 5
  `);
  console.log('\nvendor_classifications for Google Ads:');
  console.table(vc.rows);

  // 3. vendor_classification_history entries for Google Ads
  const vch = await client.query(`
    SELECT financial_row, entity_name, channel, month_key, is_preset, manually_set
    FROM vendor_classification_history
    WHERE entity_name = 'Google Ads'
    ORDER BY month_key
  `);
  console.log('\nvendor_classification_history for Google Ads:');
  console.table(vch.rows);

  // 4. How many (financial_row, entity_name, month_key) combos in netsuite_actuals
  //    are missing a corresponding history entry?
  const missing = await client.query(`
    SELECT COUNT(*) AS missing_count
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
  console.log('\nActuals combos with NO matching history entry:', missing.rows[0].missing_count);

  // 5. Sample of those missing — broken down by what vc says
  const sample = await client.query(`
    SELECT DISTINCT
      n.financial_row,
      n.entity_name,
      n.month_key,
      COALESCE(vc.channel, 'Unclassified') AS vc_channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row
          AND vc.entity_name   = n.entity_name
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_classification_history vch
      WHERE vch.financial_row = n.financial_row
        AND vch.entity_name   = n.entity_name
        AND vch.month_key     = n.month_key
    )
    ORDER BY n.month_key DESC, vc_channel
    LIMIT 15
  `);
  console.log('\nSample of actuals without history entries (newest first):');
  console.table(sample.rows);

  // 6. Among missing history entries — what channels would they inherit from vc?
  const channelBreakdown = await client.query(`
    SELECT
      COALESCE(vc.channel, 'Unclassified') AS would_inherit,
      COUNT(*) AS combos
    FROM (
      SELECT DISTINCT n.financial_row, n.entity_name, n.month_key
      FROM netsuite_actuals n
      WHERE NOT EXISTS (
        SELECT 1 FROM vendor_classification_history vch
        WHERE vch.financial_row = n.financial_row
          AND vch.entity_name   = n.entity_name
          AND vch.month_key     = n.month_key
      )
    ) missing
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = missing.financial_row
          AND vc.entity_name   = missing.entity_name
    GROUP BY COALESCE(vc.channel, 'Unclassified')
    ORDER BY combos DESC
  `);
  console.log('\nMissing history entries — channel they would inherit from vendor_classifications:');
  console.table(channelBreakdown.rows);

  await client.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
