import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

interface IngestedFileRow {
  file_path: string;
  source_name: string;
  row_count: number;
  ingested_at: string;
}

export async function GET() {
  try {
    await initDb();
    const rows = await query<IngestedFileRow>(
      `SELECT file_path, source_name, row_count, ingested_at
       FROM ingested_files
       ORDER BY ingested_at DESC
       LIMIT 20`
    );
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[api/ingest/status]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
