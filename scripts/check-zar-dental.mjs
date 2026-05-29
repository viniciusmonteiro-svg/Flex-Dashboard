/**
 * Investigate Zar Dental Consulting / 70599 - Advertising - Other
 * Focus: April 2025 (2025-04) allocation that shouldn't be there.
 */
import pkg from 'pg';
const { Client } = pkg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // ── 1. All raw netsuite rows for Zar Dental Consulting ────────────────────
  console.log('=== All netsuite_actuals rows for "Zar Dental Consulting" ===');
  const all = await client.query(`
    SELECT
      n.financial_row,
      n.month_key,
      n.tx_month,
      n.amount,
      n.description,
      n.has_name,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.entity_name ILIKE '%zar dental%'
    ORDER BY n.month_key, n.financial_row
  `);
  console.table(all.rows.map(r => ({
    gl:      r.financial_row,
    month:   r.month_key,
    tx_month:r.tx_month,
    dollars: (Number(r.amount)/100).toFixed(2),
    channel: r.channel,
    has_name:r.has_name,
    desc:    (r.description ?? '').slice(0, 80),
  })));

  // ── 2. Focus on April 2025 + 70599 ───────────────────────────────────────
  console.log('\n=== April 2025 detail for 70599 - Advertising - Other ===');
  const apr = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      n.tx_month,
      n.amount,
      n.description,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.entity_name ILIKE '%zar dental%'
      AND n.financial_row ILIKE '%70599%'
    ORDER BY n.month_key
  `);
  console.table(apr.rows.map(r => ({
    entity:  r.entity_name,
    gl:      r.financial_row,
    month:   r.month_key,
    tx_month:r.tx_month,
    dollars: (Number(r.amount)/100).toFixed(2),
    channel: r.channel,
    desc:    (r.description ?? '').slice(0, 80),
  })));

  // ── 3. Check if there's an amortization pattern — look for all vendors
  //       in 70599 for April 2025 with non-obvious allocations ─────────────
  console.log('\n=== All vendors in 70599 - Advertising - Other for 2025-04 ===');
  const gl70599apr = await client.query(`
    SELECT
      n.entity_name,
      n.month_key,
      n.tx_month,
      n.amount,
      n.description,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.financial_row ILIKE '%70599%'
      AND n.month_key = '2025-04'
    ORDER BY n.amount DESC
  `);
  console.table(gl70599apr.rows.map(r => ({
    entity:  r.entity_name.slice(0, 50),
    month:   r.month_key,
    tx_month:r.tx_month,
    dollars: (Number(r.amount)/100).toFixed(2),
    channel: r.channel,
    desc:    (r.description ?? '').slice(0, 70),
  })));
  const apr70599Total = gl70599apr.rows.reduce((s,r) => s + Number(r.amount), 0);
  console.log(`70599 April 2025 total: $${(apr70599Total/100).toFixed(2)}`);

  // ── 4. Check vendor_classifications entry for Zar Dental ─────────────────
  console.log('\n=== vendor_classifications for Zar Dental ===');
  const vc = await client.query(`
    SELECT * FROM vendor_classifications
    WHERE entity_name ILIKE '%zar dental%'
  `);
  console.table(vc.rows);

  // ── 5. Check vendor_classification_history for Zar Dental ────────────────
  console.log('\n=== vendor_classification_history for Zar Dental ===');
  const vch = await client.query(`
    SELECT * FROM vendor_classification_history
    WHERE entity_name ILIKE '%zar dental%'
    ORDER BY month_key
  `);
  console.table(vch.rows);

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
