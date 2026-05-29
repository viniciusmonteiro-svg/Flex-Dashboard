import pkg from 'pg';
const { Client } = pkg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

const SUBQUERY = `
  (SELECT
     financial_row, entity_name,
     BOOL_OR(manually_set)                                                  AS any_manually_set,
     MAX(CASE WHEN manually_set THEN COALESCE(updated_at, created_at) END)  AS last_manual_at
   FROM vendor_classification_history
   GROUP BY financial_row, entity_name) vch_any
`;

async function main() {
  await client.connect();

  // ── Test 1: All mode (month = NULL) ────────────────────────────────────────
  const allMode = await client.query(`
    SELECT
      n.financial_row,
      n.entity_name,
      COALESCE(vch.manually_set, vc.manually_set, vch_any.any_manually_set, FALSE) AS manually_set,
      COALESCE(
        CASE WHEN vch.manually_set THEN COALESCE(vch.updated_at, vch.created_at) END,
        CASE WHEN vc.manually_set  THEN vc.updated_at END,
        vch_any.last_manual_at
      ) AS updated_at
    FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = $1
    LEFT JOIN ${SUBQUERY} ON vch_any.financial_row = n.financial_row AND vch_any.entity_name = n.entity_name
    WHERE n.entity_name = 'Amortization Destination'
  `, [null]);
  console.log('Test 1 — All mode (selectedPeriod = null):');
  console.table(allMode.rows.map(r => ({
    entity: r.entity_name,
    manually_set: r.manually_set,
    updated_at: r.updated_at,
  })));

  // ── Test 2: Month mode (2026-03 — this month HAS a manual classification) ─
  const monthMode = await client.query(`
    SELECT
      n.financial_row,
      n.entity_name,
      COALESCE(vch.manually_set, vc.manually_set, vch_any.any_manually_set, FALSE) AS manually_set,
      COALESCE(
        CASE WHEN vch.manually_set THEN COALESCE(vch.updated_at, vch.created_at) END,
        CASE WHEN vc.manually_set  THEN vc.updated_at END,
        vch_any.last_manual_at
      ) AS updated_at
    FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = $1
    LEFT JOIN ${SUBQUERY} ON vch_any.financial_row = n.financial_row AND vch_any.entity_name = n.entity_name
    WHERE n.entity_name = 'Amortization Destination'
  `, ['2026-03']);
  console.log('\nTest 2 — Month mode (2026-03):');
  console.table(monthMode.rows.map(r => ({
    entity: r.entity_name,
    manually_set: r.manually_set,
    updated_at: r.updated_at,
  })));

  // ── Test 3: Sanity — preset vendor should still show manually_set=false ───
  const presetVendor = await client.query(`
    SELECT
      n.financial_row,
      n.entity_name,
      COALESCE(vch.manually_set, vc.manually_set, vch_any.any_manually_set, FALSE) AS manually_set,
      COALESCE(
        CASE WHEN vch.manually_set THEN COALESCE(vch.updated_at, vch.created_at) END,
        CASE WHEN vc.manually_set  THEN vc.updated_at END,
        vch_any.last_manual_at
      ) AS updated_at
    FROM (SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals) n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = $1
    LEFT JOIN ${SUBQUERY} ON vch_any.financial_row = n.financial_row AND vch_any.entity_name = n.entity_name
    WHERE n.entity_name = 'Google Ads'
  `, [null]);
  console.log('\nTest 3 — Google Ads (preset, NOT manually set) in All mode:');
  console.table(presetVendor.rows.map(r => ({
    entity: r.entity_name,
    manually_set: r.manually_set,
    updated_at: r.updated_at,
  })));

  await client.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
