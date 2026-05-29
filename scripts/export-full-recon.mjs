/**
 * Export ALL (financial_row × entity_name) pairs with quarterly amounts and channels.
 * Outputs scripts/full-recon-data.json consumed by the Python builder.
 */
import pkg from 'pg';
import { writeFileSync } from 'fs';
const { Client } = pkg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

const QUARTERS = {
  'Q1 2025': ['2025-01','2025-02','2025-03'],
  'Q2 2025': ['2025-04','2025-05','2025-06'],
  'Q3 2025': ['2025-07','2025-08','2025-09'],
  'Q4 2025': ['2025-10','2025-11','2025-12'],
  'Q1 2026': ['2026-01','2026-02','2026-03'],
};
const allMonths = Object.values(QUARTERS).flat();
const ph = allMonths.map((_, i) => `$${i+1}`).join(',');

async function main() {
  await client.connect();

  // All (GL, vendor, month) with their current classified channel and raw netsuite amount
  const res = await client.query(`
    SELECT
      n.financial_row,
      n.entity_name,
      n.month_key,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel,
      SUM(n.amount)                                      AS cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN (${ph})
    GROUP BY n.financial_row, n.entity_name, n.month_key,
             COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY n.financial_row, n.entity_name, n.month_key
  `, allMonths);

  // Build: rows[gl][vendor] = { dbChannel, quarters: { Q: dollars } }
  const rows = {};
  for (const r of res.rows) {
    const gl      = r.financial_row;
    const vendor  = r.entity_name;
    const channel = r.channel;
    const q       = Object.entries(QUARTERS)
      .find(([, months]) => months.includes(r.month_key))?.[0];
    if (!q) continue;
    const dollars = Number(r.cents) / 100;

    if (!rows[gl]) rows[gl] = {};
    if (!rows[gl][vendor]) rows[gl][vendor] = { dbChannel: channel, quarters: {} };
    // dbChannel: keep most recent / non-Unclassified value
    if (rows[gl][vendor].dbChannel === 'Unclassified' && channel !== 'Unclassified')
      rows[gl][vendor].dbChannel = channel;
    rows[gl][vendor].quarters[q] = (rows[gl][vendor].quarters[q] ?? 0) + dollars;
  }

  const quarterList = Object.keys(QUARTERS);
  // Summary stats
  let totalPairs = 0;
  for (const gl of Object.keys(rows))
    totalPairs += Object.keys(rows[gl]).length;
  console.log(`GL accounts: ${Object.keys(rows).length}`);
  console.log(`GL×Vendor pairs: ${totalPairs}`);

  writeFileSync('scripts/full-recon-data.json', JSON.stringify({ rows, quarters: quarterList }, null, 2));
  console.log('Written: scripts/full-recon-data.json');
  await client.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
