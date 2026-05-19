import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initDb } from '../src/db/init';
import { getSources } from '../src/ingestion/registry';
import { scanSource, buildPreview } from '../src/ingestion/scanner';
import { ingestFiles } from '../src/ingestion/pipeline';
import { rebuildDerivedTables } from '../src/ingestion/rebuild';
import { execute } from '../src/db/query';

const args = process.argv.slice(2);
const isPreview = args.includes('--preview');
const isForce = args.includes('--force');
const isRebuildOnly = args.includes('--rebuild');

async function main() {
  await initDb();

  if (isRebuildOnly) {
    console.log('[ingest] --rebuild: rebuilding derived tables only');
    await rebuildDerivedTables();
    console.log('[ingest] Rebuild complete');
    return;
  }

  if (isForce && !isPreview) {
    await execute('DELETE FROM ingested_files');
    console.log('[ingest] --force: cleared ingested_files, all files will be reprocessed');
  }

  for (const source of getSources()) {
    console.log(`\n[ingest] Scanning: ${source.label}`);
    const files = await scanSource(source);

    const preview = buildPreview(source, files);
    console.log(
      `[ingest] ${preview.files_new} new | ${preview.files_updated} updated | ${preview.files_unchanged} unchanged` +
        (preview.periods.length ? ` | periods: ${preview.periods.join(', ')}` : '')
    );

    if (isPreview) {
      console.log(`[ingest] PREVIEW — skipping writes for ${source.label}`);
      continue;
    }

    const result = await ingestFiles(source, files);

    if (result.errors.length > 0) {
      console.error(`[ingest] ${result.errors.length} error(s) for ${source.label}:`);
      result.errors.forEach((e) => console.error(`  • ${e}`));
    }

    console.log(
      `[ingest] ${source.label}: ${result.rows_ingested} rows ingested from ${result.files_processed} files`
    );
  }

  if (!isPreview) {
    await rebuildDerivedTables();
    console.log('\n[ingest] Ingest complete');
  }
}

main().catch((err) => {
  console.error('[ingest] Fatal error:', err);
  process.exit(1);
});
