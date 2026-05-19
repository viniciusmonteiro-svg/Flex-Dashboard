import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { queryOne } from '@/db/query';

export async function GET() {
  try {
    await initDb();

    const [latestMonth, netsuiteCount, leadsCount, lastIngested] = await Promise.all([
      queryOne<{ month_key: string }>(
        'SELECT month_key FROM netsuite_actuals ORDER BY month_key DESC LIMIT 1'
      ),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM netsuite_actuals'),
      queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM marketing_leads'),
      queryOne<{ ingested_at: string }>(
        'SELECT ingested_at FROM ingested_files ORDER BY ingested_at DESC LIMIT 1'
      ),
    ]);

    return NextResponse.json({
      latest_month: latestMonth?.month_key ?? null,
      spend_rows: parseInt(netsuiteCount?.count ?? '0', 10),
      leads_rows: parseInt(leadsCount?.count ?? '0', 10),
      last_ingested_at: lastIngested?.ingested_at ?? null,
    });
  } catch (err) {
    console.error('[api/data-management]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
