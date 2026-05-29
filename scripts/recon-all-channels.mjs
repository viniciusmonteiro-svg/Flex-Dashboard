/**
 * Export ALL channel totals by quarter from DB for the full reconciliation.
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
const placeholders = allMonths.map((_, i) => `$${i+1}`).join(',');

async function main() {
  await client.connect();

  // ── 1. All channels × vendor × month ─────────────────────────────────────
  const rows = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel,
      SUM(n.amount) AS cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN (${placeholders})
    GROUP BY n.entity_name, n.financial_row, n.month_key,
             COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY COALESCE(vch.channel, vc.channel, 'Unclassified'), n.entity_name, n.month_key
  `, allMonths);

  // ── 2. Aggregate: channel → vendor → quarter → dollars ───────────────────
  const channelVendorQ = {};   // channel → vendor → Q → dollars
  const channelQ       = {};   // channel → Q → dollars
  const channels       = new Set();

  for (const r of rows.rows) {
    const channel = r.channel;
    const vendor  = r.entity_name;
    const quarter = Object.entries(QUARTERS)
      .find(([, months]) => months.includes(r.month_key))?.[0];
    if (!quarter) continue;

    const dollars = Number(r.cents) / 100;
    channels.add(channel);

    if (!channelQ[channel]) channelQ[channel] = {};
    channelQ[channel][quarter] = (channelQ[channel][quarter] ?? 0) + dollars;

    if (!channelVendorQ[channel]) channelVendorQ[channel] = {};
    if (!channelVendorQ[channel][vendor]) channelVendorQ[channel][vendor] = {};
    channelVendorQ[channel][vendor][quarter] =
      (channelVendorQ[channel][vendor][quarter] ?? 0) + dollars;
  }

  // ── 3. Print summary ──────────────────────────────────────────────────────
  const qs = Object.keys(QUARTERS);
  console.log('DB totals by channel × quarter:');
  console.log(
    ['Channel'.padEnd(35), ...qs.map(q => q.padStart(12))].join(' ')
  );
  let grandQ = {};
  for (const ch of [...channels].sort()) {
    const vals = qs.map(q => (channelQ[ch]?.[q] ?? 0));
    vals.forEach((v, i) => { grandQ[qs[i]] = (grandQ[qs[i]] ?? 0) + v; });
    console.log(
      ch.padEnd(35) + ' ' + vals.map(v => v.toFixed(0).padStart(12)).join(' ')
    );
  }
  console.log('-'.repeat(35 + 13 * qs.length));
  console.log(
    'TOTAL'.padEnd(35) + ' ' + qs.map(q => (grandQ[q] ?? 0).toFixed(0).padStart(12)).join(' ')
  );

  const output = {
    channels: [...channels].sort(),
    quarters: qs,
    channelQ,
    channelVendorQ,
  };
  writeFileSync('scripts/db-all-channels.json', JSON.stringify(output, null, 2));
  console.log('\nWritten: scripts/db-all-channels.json');

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
