import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';
import { withConnection } from '@/db/connection';

export async function POST(req: NextRequest) {
  try {
    await initDb();

    const body = await req.json();
    const { financial_row, entity_name, channel, month_key } = body as {
      financial_row: string;
      entity_name: string;
      channel: string;
      month_key?: string; // if provided → this month only; absent → all months + current
    };

    if (!entity_name || !channel) {
      return NextResponse.json({ error: 'entity_name and channel are required' }, { status: 400 });
    }

    const fr = financial_row ?? '';

    if (month_key) {
      // Month-specific: update vendor_classification_history for this month only
      await execute(
        `INSERT INTO vendor_classification_history
           (financial_row, entity_name, channel, month_key, is_preset, manually_set, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, TRUE, NOW())
         ON CONFLICT (financial_row, entity_name, month_key) DO UPDATE
           SET channel      = EXCLUDED.channel,
               manually_set = TRUE,
               updated_at   = NOW()`,
        [fr, entity_name, channel, month_key]
      );
    } else {
      // Global: update vendor_classifications (current) + all history months for this vendor
      await withConnection(async (client) => {
        // 1. Update current classification
        await client.query(
          `INSERT INTO vendor_classifications
             (financial_row, entity_name, channel, is_preset, manually_set, updated_at)
           VALUES ($1, $2, $3, FALSE, TRUE, NOW())
           ON CONFLICT (financial_row, entity_name) DO UPDATE
             SET channel      = EXCLUDED.channel,
                 manually_set = TRUE,
                 updated_at   = NOW()`,
          [fr, entity_name, channel]
        );

        // 2. Propagate to history for every month this vendor has netsuite data
        await client.query(
          `INSERT INTO vendor_classification_history
             (financial_row, entity_name, channel, month_key, is_preset, manually_set)
           SELECT $1, $2, $3, month_key, FALSE, TRUE
           FROM (
             SELECT DISTINCT month_key
             FROM netsuite_actuals
             WHERE financial_row = $1 AND entity_name = $2
           ) mk
           ON CONFLICT (financial_row, entity_name, month_key) DO UPDATE
             SET channel      = EXCLUDED.channel,
                 manually_set = TRUE`,
          [fr, entity_name, channel]
        );
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/vendor-classifications/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
