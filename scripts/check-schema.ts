import { getPoolInstance } from '../src/db/connection';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
  const pool = getPoolInstance();
  const r = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='salesforce_opportunities' ORDER BY ordinal_position"
  );
  console.log('Columns:', r.rows.map((x: {column_name: string; data_type: string}) => `${x.column_name} (${x.data_type})`).join(', '));

  const r2 = await pool.query(
    "SELECT COUNT(*) total, COUNT(close_date) with_close_date FROM salesforce_opportunities WHERE stage='Closed Won'"
  );
  console.log('Closed Won close_date coverage:', r2.rows[0]);

  const r3 = await pool.query(
    "SELECT COUNT(*) FROM salesforce_opportunities WHERE close_date IS NOT NULL AND stage='Closed Won'"
  );
  console.log('Closed Won with close_date:', r3.rows[0].count);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
