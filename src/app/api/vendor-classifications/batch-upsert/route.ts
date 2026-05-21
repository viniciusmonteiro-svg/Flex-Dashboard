import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { withConnection } from '@/db/connection';

interface ChangeItem {
  financial_row: string;
  entity_name: string;
  channel: string;
  month_key?: string; // present → this month only; absent → all months + current
}

export async function POST(req: NextRequest) {
  try {
    await initDb();

    const body = await req.json();
    const { changes } = body as { changes: ChangeItem[] };

    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: 'changes array is required' }, { status: 400 });
    }

    const errors: string[] = [];
    let saved = 0;

    // Partition changes: history-mode items carry month_key; current-mode items do not.
    const monthItems  = changes.filter((c) => !!c.month_key);
    const globalItems = changes.filter((c) => !c.month_key);

    await withConnection(async (client) => {
      await client.query('BEGIN');
      try {
        // ── History-mode: update only the specific month's history record ──
        for (const { financial_row, entity_name, channel, month_key } of monthItems) {
          if (!entity_name || !channel || !month_key) {
            errors.push(`Missing fields for row: ${financial_row}`);
            continue;
          }
          const fr = financial_row ?? '';
          await client.query(
            `INSERT INTO vendor_classification_history
               (financial_row, entity_name, channel, month_key, is_preset, manually_set)
             VALUES ($1, $2, $3, $4, FALSE, TRUE)
             ON CONFLICT (financial_row, entity_name, month_key) DO UPDATE
               SET channel      = EXCLUDED.channel,
                   manually_set = TRUE`,
            [fr, entity_name, channel, month_key]
          );
          saved++;
        }

        // ── Current-mode: update canonical vendor_classifications + all history months ──
        for (const { financial_row, entity_name, channel } of globalItems) {
          if (!entity_name || !channel) {
            errors.push(`Missing entity_name or channel for row: ${financial_row}`);
            continue;
          }
          const fr = financial_row ?? '';

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

          saved++;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    return NextResponse.json({ saved, errors, month_items: monthItems.length, global_items: globalItems.length });
  } catch (err) {
    console.error('[api/vendor-classifications/batch-upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
