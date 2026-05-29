import pkg from 'pg';
const { Client } = pkg;

const DNT = 'Do Not Tag (COGS/Non-S&M)';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  await client.connect();
  console.log('Connected to DB\n');

  // Step 1: Upsert vendor_classifications for all GL-prefix pairs from netsuite_actuals
  const upsertRes = await client.query(
    `INSERT INTO vendor_classifications (financial_row, entity_name, channel, is_preset, manually_set, updated_at)
     SELECT DISTINCT financial_row, entity_name, $1, TRUE, FALSE, NOW()
     FROM netsuite_actuals
     WHERE financial_row ~ '^(54|55|60)[0-9]'
     ON CONFLICT (financial_row, entity_name) DO UPDATE
       SET channel    = EXCLUDED.channel,
           is_preset  = TRUE,
           updated_at = NOW()
     WHERE vendor_classifications.manually_set = FALSE`,
    [DNT]
  );
  console.log('vendor_classifications upserted/updated:', upsertRes.rowCount);

  // Step 2: Upsert vendor_classification_history for GL-prefix pairs (all months)
  const histRes = await client.query(
    `INSERT INTO vendor_classification_history (financial_row, entity_name, channel, month_key, is_preset, manually_set)
     SELECT DISTINCT n.financial_row, n.entity_name, $1, n.month_key, TRUE, FALSE
     FROM netsuite_actuals n
     WHERE n.financial_row ~ '^(54|55|60)[0-9]'
     ON CONFLICT (financial_row, entity_name, month_key) DO UPDATE
       SET channel   = EXCLUDED.channel,
           is_preset = TRUE
     WHERE vendor_classification_history.manually_set = FALSE`,
    [DNT]
  );
  console.log('vendor_classification_history upserted/updated:', histRes.rowCount);

  // Step 3: Verification query (user spec)
  const verify = await client.query(
    `SELECT LEFT(financial_row, 5) as gl_prefix, channel, COUNT(*) as vendor_count
     FROM vendor_classifications
     WHERE financial_row ~ '^(54|55|60)'
     GROUP BY gl_prefix, channel
     ORDER BY gl_prefix`
  );
  console.log('\nVerification — vendor_classifications GL rows:\n');
  console.table(verify.rows);

  // Also check if any manually_set rows were preserved (not overwritten)
  const manual = await client.query(
    `SELECT financial_row, entity_name, channel
     FROM vendor_classifications
     WHERE financial_row ~ '^(54|55|60)[0-9]'
       AND manually_set = TRUE`
  );
  if (manual.rows.length > 0) {
    console.log('\nManually-set rows preserved (not overwritten):');
    console.table(manual.rows);
  } else {
    console.log('\nNo manually-set rows in GL prefix range.');
  }

  await client.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
