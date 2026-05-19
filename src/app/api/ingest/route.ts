import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { getSources } from '@/ingestion/registry';
import { scanSource } from '@/ingestion/scanner';
import { ingestFiles } from '@/ingestion/pipeline';
import { rebuildDerivedTables } from '@/ingestion/rebuild';

export async function POST() {
  try {
    await initDb();
    const sources = getSources();

    const results = [];
    for (const source of sources) {
      const files = await scanSource(source);
      const result = await ingestFiles(source, files);
      results.push({ source: source.name, ...result });
    }

    await rebuildDerivedTables();

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[api/ingest]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
