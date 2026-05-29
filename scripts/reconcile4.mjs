/**
 * Reconcile4: Figure out what produces $472,539 and what the $171.10 gap is.
 *
 * User says:
 *   "Suming at our file all unclassified records where the name/memo field
 *    contains 'trade show', I get a total of $472,539.00"
 *   "vs 472,367.90 from the file attached [Excel]"
 *
 * Hypothesis A: user is summing ALL rows (any channel) where name OR memo
 *               contains 'trade show' text in Q1 2026.
 * Hypothesis B: user is summing Trade Show channel + unclassified with text.
 * Hypothesis C: user is looking at financial_row that contains 'trade show'.
 */
import pkg from 'pg';
const { Client } = pkg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // ── A. ALL rows where name OR memo contains 'trade show' (no channel filter) ──
  const allTS = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      n.amount,
      n.description,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND (
        n.entity_name ILIKE '%trade show%'
        OR n.description ILIKE '%trade show%'
      )
    ORDER BY n.amount DESC
  `);
  const allTSTotal = allTS.rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`\n=== Hypothesis A: ALL rows with 'trade show' in name/memo ===`);
  console.log(`Row count: ${allTS.rows.length}`);
  console.log(`Total: $${(allTSTotal/100).toFixed(2)}`);
  console.table(allTS.rows.map(r => ({
    entity: r.entity_name.slice(0, 45),
    fr: r.financial_row.slice(0, 30),
    month: r.month_key,
    dollars: (Number(r.amount)/100).toFixed(2),
    channel: r.channel,
    desc: (r.description ?? '').slice(0, 55),
  })));

  // ── B. Trade Show channel total (for reference) ──────────────────────────
  const tsChannel = await client.query(`
    SELECT SUM(n.amount) AS cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') = 'Trade Show'
  `);
  const tsChannelTotal = Number(tsChannel.rows[0].cents);
  console.log(`\n=== Hypothesis B sub-totals ===`);
  console.log(`Trade Show channel total: $${(tsChannelTotal/100).toFixed(2)}`);

  // ── C. financial_row contains 'trade show' (GL account) ─────────────────
  const tsGL = await client.query(`
    SELECT
      n.financial_row,
      n.entity_name,
      n.month_key,
      SUM(n.amount) AS cents,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND n.financial_row ILIKE '%trade show%'
    GROUP BY n.financial_row, n.entity_name, n.month_key,
             COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY SUM(n.amount) DESC
  `);
  const tsGLTotal = tsGL.rows.reduce((s, r) => s + Number(r.cents), 0);
  console.log(`\n=== Hypothesis C: financial_row contains 'trade show' ===`);
  console.log(`Total: $${(tsGLTotal/100).toFixed(2)}`);
  console.table(tsGL.rows.map(r => ({
    fr: r.financial_row,
    entity: r.entity_name.slice(0, 40),
    month: r.month_key,
    dollars: (Number(r.cents)/100).toFixed(2),
    channel: r.channel,
  })));

  // ── D. GL 70602 = "Trade Show - Materials and Rentals" ───────────────────
  const gl70602 = await client.query(`
    SELECT
      n.entity_name,
      n.month_key,
      SUM(n.amount) AS cents,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND n.financial_row LIKE '70602%'
    GROUP BY n.entity_name, n.month_key,
             COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY SUM(n.amount) DESC
  `);
  const gl70602Total = gl70602.rows.reduce((s, r) => s + Number(r.cents), 0);
  console.log(`\n=== GL 70602 (Trade Show - Materials and Rentals) all vendors ===`);
  console.log(`Total: $${(gl70602Total/100).toFixed(2)}`);
  console.table(gl70602.rows.map(r => ({
    entity: r.entity_name.slice(0, 45),
    month: r.month_key,
    dollars: (Number(r.cents)/100).toFixed(2),
    channel: r.channel,
  })));

  // ── E. Full GL breakdown for Trade Show related accounts (70xxx) ──────────
  const gl70 = await client.query(`
    SELECT
      SUBSTRING(n.financial_row, 1, 5) AS gl_code,
      n.financial_row,
      SUM(n.amount) AS cents,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND n.financial_row LIKE '70%'
    GROUP BY SUBSTRING(n.financial_row, 1, 5), n.financial_row,
             COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY SUM(n.amount) DESC
  `);
  console.log(`\n=== All GL 70xxx accounts Q1 2026 ===`);
  console.table(gl70.rows.map(r => ({
    gl: r.financial_row.slice(0, 45),
    channel: r.channel,
    dollars: (Number(r.cents)/100).toFixed(2),
  })));

  // ── F. What sums to $472,539? ─────────────────────────────────────────────
  // Try: Trade Show channel + GL 70602 unclassified rows
  const ts_plus_70602_uncl = tsChannelTotal +
    gl70602.rows.filter(r => r.channel === 'Unclassified')
               .reduce((s, r) => s + Number(r.cents), 0);
  console.log(`\n=== Candidate combinations ===`);
  console.log(`Trade Show channel: $${(tsChannelTotal/100).toFixed(2)}`);
  console.log(`GL 70602 total: $${(gl70602Total/100).toFixed(2)}`);
  console.log(`GL 70602 unclassified: $${(gl70602.rows.filter(r=>r.channel==='Unclassified').reduce((s,r)=>s+Number(r.cents),0)/100).toFixed(2)}`);
  console.log(`TS channel + GL70602 unclassified: $${(ts_plus_70602_uncl/100).toFixed(2)}`);

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
