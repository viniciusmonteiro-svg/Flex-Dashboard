import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query, execute } from '@/db/query';
import { PAIR_CLASSIFICATIONS } from '@/lib/vendorPresets';

const DNT = 'Do Not Tag (COGS/Non-S&M)';

export async function POST() {
  try {
    await initDb();

    const pairs = await query<{ financial_row: string; entity_name: string }>(
      'SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals'
    );

    const total_pairs = pairs.length;
    let applied = 0;

    for (const { financial_row, entity_name } of pairs) {
      const pairKey = `${financial_row}|${entity_name}`;

      // Priority 1: exact pair match
      let channel = PAIR_CLASSIFICATIONS[pairKey];

      // Priority 2: blank / journal sentinel → Do Not Tag
      if (!channel && (!entity_name || entity_name === '(No vendor — journal/payroll/accrual)')) {
        channel = DNT;
      }

      // Priority 3: no match → leave Unclassified (skip)
      if (!channel) continue;

      await execute(
        `INSERT INTO vendor_classifications (financial_row, entity_name, channel, is_preset, manually_set, updated_at)
         VALUES ($1, $2, $3, TRUE, FALSE, NOW())
         ON CONFLICT (financial_row, entity_name) DO UPDATE
           SET channel    = EXCLUDED.channel,
               is_preset  = TRUE,
               updated_at = NOW()
         WHERE vendor_classifications.manually_set = FALSE`,
        [financial_row, entity_name, channel]
      );
      applied++;
    }

    return NextResponse.json({ ok: true, applied, total_pairs });
  } catch (err) {
    console.error('[api/vendor-classifications/apply-presets]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
