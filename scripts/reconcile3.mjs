/**
 * Focused reconciliation:
 * 1. Hotel-Misc (US) breakdown by financial_row + month
 * 2. Search for Opportunityretreiv (or similar)
 * 3. Find transactions near $171 difference
 * 4. Check what the user's raw "sum of unclassified with trade show text" actually sums
 */
import pkg from 'pg';
const { Client } = pkg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // ── 1. Hotel-Misc (US) breakdown ──────────────────────────────────────────
  console.log('=== Hotel-Misc (US) detail — all Q1 2026 rows ===');
  const hotel = await client.query(`
    SELECT
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
    WHERE n.entity_name = 'Hotel-Misc (US)'
      AND n.month_key IN ('2026-01','2026-02','2026-03')
    ORDER BY n.month_key, n.amount DESC
  `);
  console.table(hotel.rows.map(r => ({
    financial_row: r.financial_row,
    month: r.month_key,
    tx_month: r.tx_month,
    dollars: (Number(r.amount)/100).toFixed(2),
    channel: r.channel,
    desc: (r.description ?? '').slice(0, 60),
  })));
  const hotelTotal = hotel.rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`Hotel-Misc (US) Q1 2026 total (all channels): $${(hotelTotal/100).toFixed(2)}`);

  const hotelTS = hotel.rows.filter(r => r.channel === 'Trade Show');
  const hotelTSTotal = hotelTS.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`Hotel-Misc (US) classified as Trade Show: $${(hotelTSTotal/100).toFixed(2)}`);

  // ── 2. Search for Opportunityretreiv (fuzzy) ──────────────────────────────
  console.log('\n=== Opportunityretreiv — fuzzy search ===');
  const oppo = await client.query(`
    SELECT DISTINCT entity_name, financial_row,
      SUM(amount) OVER (PARTITION BY entity_name) AS total_cents
    FROM netsuite_actuals
    WHERE month_key IN ('2026-01','2026-02','2026-03')
      AND (
        entity_name ILIKE '%opportun%'
        OR entity_name ILIKE '%retri%'
        OR entity_name ILIKE '%opp%ret%'
      )
    ORDER BY total_cents DESC
  `);
  if (oppo.rows.length) {
    console.table(oppo.rows.map(r => ({
      entity_name: r.entity_name,
      financial_row: r.financial_row,
      total_dollars: (Number(r.total_cents)/100).toFixed(2),
    })));
  } else {
    console.log('No match found for Opportunityretreiv.');
  }

  // ── 3. Exact "raw sum" the user computes — all unclassified rows with trade show text ──
  // This is what they called $472,539.00
  console.log('\n=== User raw sum: Unclassified rows with "trade show" text Q1 2026 ===');
  const rawSum = await client.query(`
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
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') IN ('Trade Show', 'Unclassified')
      AND (
        n.entity_name ILIKE '%trade show%'
        OR n.description ILIKE '%trade show%'
      )
    ORDER BY n.amount DESC
  `);
  console.log(`Rows: ${rawSum.rows.length}`);
  const rawTotal = rawSum.rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`Total: $${(rawTotal/100).toFixed(2)}`);

  // Break it into classified vs unclassified
  const classified   = rawSum.rows.filter(r => r.channel === 'Trade Show');
  const unclassified = rawSum.rows.filter(r => r.channel === 'Unclassified');
  const classTotal   = classified.reduce((s, r) => s + Number(r.amount), 0);
  const unclTotal    = unclassified.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`  → Trade Show classified rows: ${classified.length}, total $${(classTotal/100).toFixed(2)}`);
  console.log(`  → Unclassified rows:          ${unclassified.length}, total $${(unclTotal/100).toFixed(2)}`);

  // ── 4. The user said they sum ALL unclassified rows with trade show text
  //       Let's isolate exactly that
  console.log('\n=== ONLY Unclassified rows with "trade show" text Q1 2026 ===');
  const unclassOnly = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      n.amount,
      n.description
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') = 'Unclassified'
      AND (
        n.entity_name ILIKE '%trade show%'
        OR n.description ILIKE '%trade show%'
      )
    ORDER BY n.amount DESC
  `);
  console.table(unclassOnly.rows.map(r => ({
    entity: r.entity_name.slice(0,50),
    fr: r.financial_row,
    month: r.month_key,
    dollars: (Number(r.amount)/100).toFixed(2),
    desc: (r.description ?? '').slice(0,60),
  })));
  const unclassOnlyTotal = unclassOnly.rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`Unclassified "trade show" total: $${(unclassOnlyTotal/100).toFixed(2)}`);

  // ── 5. Full Trade Show + Unclassified-trade-show combined ────────────────
  console.log('\n=== Combined: Trade Show channel + Unclassified with trade show text ===');
  const tsTotal = await client.query(`
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
  const tsDbTotal = Number(tsTotal.rows[0].cents);
  const combined = tsDbTotal + unclassOnlyTotal;
  console.log(`DB Trade Show classified:         $${(tsDbTotal/100).toFixed(2)}`);
  console.log(`Unclassified with trade show text:$${(unclassOnlyTotal/100).toFixed(2)}`);
  console.log(`Combined:                         $${(combined/100).toFixed(2)}`);
  console.log(`User says: $472,539.00`);
  console.log(`Diff from user: $${((combined/100) - 472539).toFixed(2)}`);
  console.log(`Excel says: $472,367.90`);
  console.log(`Diff from Excel: $${((combined/100) - 472367.90).toFixed(2)}`);

  // ── 6. Check for BestBuy row (in memo "trade show", unclassified) ─────────
  console.log('\n=== BestBuy - US detail (all Q1 2026) ===');
  const bb = await client.query(`
    SELECT n.financial_row, n.month_key, n.amount, n.description,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.entity_name = 'BestBuy - US'
      AND n.month_key IN ('2026-01','2026-02','2026-03')
  `);
  console.table(bb.rows.map(r => ({
    fr: r.financial_row,
    month: r.month_key,
    dollars: (Number(r.amount)/100).toFixed(2),
    channel: r.channel,
    desc: (r.description ?? '').slice(0,70),
  })));

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
