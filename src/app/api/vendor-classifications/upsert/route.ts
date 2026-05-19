import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();

    const body = await req.json();
    const { financial_row, entity_name, channel } = body as {
      financial_row: string;
      entity_name: string;
      channel: string;
    };

    if (!entity_name || !channel) {
      return NextResponse.json({ error: 'entity_name and channel are required' }, { status: 400 });
    }

    await execute(
      `INSERT INTO vendor_classifications (financial_row, entity_name, channel, is_preset, manually_set, updated_at)
       VALUES ($1, $2, $3, FALSE, TRUE, NOW())
       ON CONFLICT (financial_row, entity_name) DO UPDATE
         SET channel      = EXCLUDED.channel,
             manually_set = TRUE,
             updated_at   = NOW()`,
      [financial_row ?? '', entity_name, channel]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/vendor-classifications/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
