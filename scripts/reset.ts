import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initDb } from '../src/db/init';
import { execute } from '../src/db/query';

async function main() {
  await initDb();

  await execute('DELETE FROM vendor_classifications');
  console.log('Cleared: vendor_classifications');

  await execute('DELETE FROM ingested_files');
  console.log('Cleared: ingested_files');

  await execute('DELETE FROM netsuite_actuals');
  console.log('Cleared: netsuite_actuals');

  await execute('DELETE FROM marketing_leads');
  console.log('Cleared: marketing_leads');

  console.log('\nReset complete — ready for fresh ingest');
}

main().catch((err) => {
  console.error('[reset] Fatal error:', err);
  process.exit(1);
});
