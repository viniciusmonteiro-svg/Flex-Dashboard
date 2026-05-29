/**
 * Export: per-vendor Trade Show amounts by quarter from DB + Excel, for reconciliation.
 * Outputs JSON files consumed by the Python builder script.
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

async function main() {
  await client.connect();

  const allMonths = Object.values(QUARTERS).flat();
  const placeholders = allMonths.map((_, i) => `$${i+1}`).join(',');

  // ── 1. DB: Trade Show channel totals per vendor per month ─────────────────
  const dbRows = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      SUM(n.amount) AS cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN (${placeholders})
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') = 'Trade Show'
    GROUP BY n.entity_name, n.financial_row, n.month_key
    ORDER BY n.entity_name, n.month_key
  `, allMonths);

  // ── 2. DB: Unclassified rows in Trade Show GL accounts (70601, 70602) ─────
  // These appear in the Excel (journal accruals, Amortization Destination, etc.)
  const unclassRows = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      SUM(n.amount) AS cents,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN (${placeholders})
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') != 'Trade Show'
      AND n.financial_row ~ '^7060[12]'
    GROUP BY n.entity_name, n.financial_row, n.month_key,
             COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY n.entity_name, n.month_key
  `, allMonths);

  // ── 3. Build quarter → vendor map for DB (Trade Show classified) ───────────
  const dbByVendorQ = {}; // { vendor: { Q: dollars } }
  for (const r of dbRows.rows) {
    const vendor = r.entity_name;
    const quarter = Object.entries(QUARTERS).find(([, months]) => months.includes(r.month_key))?.[0];
    if (!quarter) continue;
    const dollars = Number(r.cents) / 100;
    if (!dbByVendorQ[vendor]) dbByVendorQ[vendor] = {};
    dbByVendorQ[vendor][quarter] = (dbByVendorQ[vendor][quarter] ?? 0) + dollars;
  }

  // ── 4. Quarter totals summary ─────────────────────────────────────────────
  const quarterTotals = {};
  for (const q of Object.keys(QUARTERS)) {
    quarterTotals[q] = 0;
    for (const v of Object.values(dbByVendorQ)) {
      quarterTotals[q] += v[q] ?? 0;
    }
  }

  // ── 5. Unclassified 70601/70602 breakdown ────────────────────────────────
  const unclByVendorQ = {};
  for (const r of unclassRows.rows) {
    const vendor = r.entity_name;
    const quarter = Object.entries(QUARTERS).find(([, months]) => months.includes(r.month_key))?.[0];
    if (!quarter) continue;
    const dollars = Number(r.cents) / 100;
    if (!unclByVendorQ[vendor]) unclByVendorQ[vendor] = { channel: r.channel, quarters: {} };
    unclByVendorQ[vendor].quarters[quarter] = (unclByVendorQ[vendor].quarters[quarter] ?? 0) + dollars;
  }

  const output = {
    dbByVendorQ,
    quarterTotals,
    unclByVendorQ,
    quarters: Object.keys(QUARTERS),
  };

  writeFileSync('scripts/recon-data.json', JSON.stringify(output, null, 2));
  console.log('DB quarter totals:');
  for (const [q, t] of Object.entries(quarterTotals)) {
    console.log(`  ${q}: $${t.toFixed(2)}`);
  }
  console.log(`DB vendors with Trade Show data: ${Object.keys(dbByVendorQ).length}`);
  console.log(`Unclassified 70601/70602 vendors: ${Object.keys(unclByVendorQ).length}`);
  console.log('Written: scripts/recon-data.json');

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
