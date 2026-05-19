import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { getSources } from '@/ingestion/registry';
import { scanSource } from '@/ingestion/scanner';
import { ingestFiles } from '@/ingestion/pipeline';
import { rebuildDerivedTables } from '@/ingestion/rebuild';

export async function POST(req: NextRequest) {
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

    // Only rebuild derived tables when all sources are ingested together
    if (!sourceParam) {
      await rebuildDerivedTables();
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[api/ingest]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
