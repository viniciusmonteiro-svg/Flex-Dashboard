import { getPoolInstance } from '../src/db/connection';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function reset() {
  const pool = getPoolInstance();
  const before = await pool.query('SELECT COUNT(*) FROM salesforce_opportunities');
  console.log('Before truncate:', before.rows[0].count, 'rows');
  await pool.query('TRUNCATE salesforce_opportunities RESTART IDENTITY CASCADE');
  const after = await pool.query('SELECT COUNT(*) FROM salesforce_opportunities');
  console.log('After truncate:', after.rows[0].count, 'rows');
  const del = await pool.query("DELETE FROM ingested_files WHERE file_name LIKE '%SalesForce%' RETURNING file_name");
  console.log('Deleted ingested_files records:', (del.rows as {file_name: string}[]).map(r => r.file_name));
  await pool.end();
}

reset().catch(e => { console.error(e); process.exit(1); });
