import { getPoolInstance } from '../src/db/connection';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
  const pool = getPoolInstance();

  await pool.query(`
    ALTER TABLE salesforce_opportunities
      ADD COLUMN IF NOT EXISTS primary_campaign_name TEXT
  `);
  console.log('Column added (or already exists).');

  const r = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'salesforce_opportunities'
      AND column_name = 'primary_campaign_name'
  `);
  console.log('Column present:', r.rows.length === 1);

  // Reset ingested_files so the next ingest re-processes SalesForce.xls
  const del = await pool.query(
    "DELETE FROM ingested_files WHERE file_name LIKE '%SalesForce%' RETURNING file_name"
  );
  console.log('Cleared ingested_files:', del.rows.map((x: { file_name: string }) => x.file_name));

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
