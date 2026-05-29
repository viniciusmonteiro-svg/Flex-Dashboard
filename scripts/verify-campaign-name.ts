import { getPoolInstance } from '../src/db/connection';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
  const pool = getPoolInstance();

  const r = await pool.query(`
    SELECT primary_campaign_name, COUNT(*) AS cnt
    FROM salesforce_opportunities
    WHERE primary_campaign_name IS NOT NULL
    GROUP BY primary_campaign_name
    ORDER BY cnt DESC
    LIMIT 20
  `);

  if (r.rows.length === 0) {
    console.log('No rows with primary_campaign_name set — column may be absent from source file.');
  } else {
    console.log('Top primary_campaign_name values:');
    for (const row of r.rows as { primary_campaign_name: string; cnt: string }[]) {
      console.log(`  ${String(row.cnt).padStart(5)}  ${row.primary_campaign_name}`);
    }
  }

  const totals = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(primary_campaign_name) AS with_name,
      COUNT(*) - COUNT(primary_campaign_name) AS without_name
    FROM salesforce_opportunities
  `);
  console.log('\nCoverage:', totals.rows[0]);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
