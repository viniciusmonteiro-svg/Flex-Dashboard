import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { getSources } from '@/ingestion/registry';
import { scanSource } from '@/ingestion/scanner';

export async function POST() {
  try {
    await initDb();
    const sources = getSources();

    const results = await Promise.all(
      sources.map(async (source) => {
        const files = await scanSource(source);
        return {
          source: source.name,
          new_files: files.filter((f) => f.status === 'new').length,
          updated_files: files.filter((f) => f.status === 'updated').length,
          unchanged_files: files.filter((f) => f.status === 'unchanged').length,
          invalid_files: files.filter((f) => f.status === 'invalid').length,
          files: files.map((f) => ({ path: f.path, status: f.status })),
        };
      })
    );

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[api/ingest/preview]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
