import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { getSources } from '@/ingestion/registry';
import { scanSource } from '@/ingestion/scanner';
import { ingestFiles } from '@/ingestion/pipeline';
import { rebuildDerivedTables } from '@/ingestion/rebuild';

export async function POST(req: NextRequest) {
  if (!process.env.SOURCE_DATA_PATH) {
    return NextResponse.json(
      { error: 'Ingestion not available in this environment' },
      { status: 400 }
    );
  }

  try {
    await initDb();

    const sourceParam = new URL(req.url).searchParams.get('source');
    // 'netsuite' → netsuiteSpend, 'salesforce' → salesforceLeads, null → all

    const allSources = getSources();
    const sources =
      sourceParam === 'netsuite'
        ? allSources.filter((s) => s.name === 'netsuiteSpend')
        : sourceParam === 'salesforce'
        ? allSources.filter((s) => s.name === 'salesforceLeads')
        : allSources;

    const results = [];
    for (const source of sources) {
      const files = await scanSource(source);
      const result = await ingestFiles(source, files);
      results.push({ source: source.name, label: source.label, ...result });
    }

    // Rebuild classification history after every ingest, regardless of which source.
    // This creates vendor_classification_history entries for any new
    // (financial_row, entity_name, month_key) tuples and auto-classifies
    // GL-prefix vendors (54/55/60xxx) that appear for the first time.
    // Salesforce-only ingests are also safe — the function is idempotent.
    await rebuildDerivedTables();

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[api/ingest]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
