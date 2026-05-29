import { getPoolInstance } from '../src/db/connection';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function verify() {
  const pool = getPoolInstance();

  const total = await pool.query('SELECT COUNT(*) FROM salesforce_opportunities');
  console.log('Total rows:', total.rows[0].count);

  const channeled = await pool.query(`
    SELECT COUNT(*) FROM salesforce_opportunities
    WHERE COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')
  `);
  console.log('Channeled rows:', channeled.rows[0].count);

  const unclassified = await pool.query(`
    SELECT COUNT(*) FROM salesforce_opportunities
    WHERE COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') = 'Unclassified'
  `);
  console.log('Unclassified rows:', unclassified.rows[0].count);

  const byChannel = await pool.query(`
    SELECT primary_channel, COUNT(*) AS cnt
    FROM salesforce_opportunities
    WHERE COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')
    GROUP BY primary_channel
    ORDER BY cnt DESC
  `);
  console.log('\nChanneled breakdown:');
  for (const r of byChannel.rows as {primary_channel: string; cnt: string}[]) {
    console.log(`  ${r.primary_channel}: ${r.cnt}`);
  }

  const byStageChanneled = await pool.query(`
    SELECT stage, COUNT(*) AS cnt
    FROM salesforce_opportunities
    WHERE COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')
    GROUP BY stage ORDER BY cnt DESC
  `);
  console.log('\nChanneled by stage:');
  for (const r of byStageChanneled.rows as {stage: string; cnt: string}[]) {
    console.log(`  ${r.stage}: ${r.cnt}`);
  }

  const byQuarter = await pool.query(`
    SELECT
      LEFT(created_month, 4) || '-Q' || CEIL(CAST(SPLIT_PART(created_month, '-', 2) AS int) / 3.0)::int::text AS qtr,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')) AS channeled,
      COUNT(*) FILTER (WHERE stage = 'Closed Won' AND COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')) AS won_channeled
    FROM salesforce_opportunities
    WHERE created_month IS NOT NULL AND created_month != ''
    GROUP BY qtr ORDER BY qtr DESC LIMIT 8
  `);
  console.log('\nLast 8 quarters (total | channeled | won_channeled):');
  for (const r of byQuarter.rows as {qtr: string; total: string; channeled: string; won_channeled: string}[]) {
    console.log(`  ${r.qtr}: ${r.total} total | ${r.channeled} channeled | ${r.won_channeled} won`);
  }

  await pool.end();
}

verify().catch(e => { console.error(e); process.exit(1); });
