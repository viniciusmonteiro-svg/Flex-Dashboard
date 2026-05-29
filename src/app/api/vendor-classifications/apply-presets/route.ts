import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { withConnection } from '@/db/connection';
import { PAIR_CLASSIFICATIONS, getGlPrefixChannel } from '@/lib/vendorPresets';

const DNT = 'Do Not Tag (COGS/Non-S&M)';

export async function POST() {
  try {
    await initDb();

    const pairs = await query<{ financial_row: string; entity_name: string }>(
      'SELECT DISTINCT financial_row, entity_name FROM netsuite_actuals'
    );

    const total_pairs = pairs.length;
    let applied = 0;
    let gl_applied = 0;

    await withConnection(async (client) => {
      for (const { financial_row, entity_name } of pairs) {
        const pairKey = `${financial_row}|${entity_name}`;

        // Priority 1: GL prefix rule (highest — overrides pair classification)
        let channel = getGlPrefixChannel(financial_row);
        if (channel) gl_applied++;

        // Priority 2: exact pair match in preset map
        if (!channel) channel = PAIR_CLASSIFICATIONS[pairKey] ?? null;

        // Priority 3: blank / journal sentinel → Do Not Tag
        if (!channel && (!entity_name || entity_name === '(No vendor — journal/payroll/accrual)')) {
          channel = DNT;
        }

        // Priority 4: no match → leave Unclassified (skip)
        if (!channel) continue;

        // Update current vendor_classifications (only if not manually overridden)
        await client.query(
          `INSERT INTO vendor_classifications
             (financial_row, entity_name, channel, is_preset, manually_set, updated_at)
           VALUES ($1, $2, $3, TRUE, FALSE, NOW())
           ON CONFLICT (financial_row, entity_name) DO UPDATE
             SET channel    = EXCLUDED.channel,
                 is_preset  = TRUE,
                 updated_at = NOW()
           WHERE vendor_classifications.manually_set = FALSE`,
          [financial_row, entity_name, channel]
        );

        // Propagate preset to history for every month (skip months with manual overrides)
        await client.query(
          `INSERT INTO vendor_classification_history
             (financial_row, entity_name, channel, month_key, is_preset, manually_set)
           SELECT $1, $2, $3, month_key, TRUE, FALSE
           FROM (
             SELECT DISTINCT month_key
             FROM netsuite_actuals
             WHERE financial_row = $1 AND entity_name = $2
           ) mk
           ON CONFLICT (financial_row, entity_name, month_key) DO UPDATE
             SET channel   = EXCLUDED.channel,
                 is_preset = TRUE
           WHERE vendor_classification_history.manually_set = FALSE`,
          [financial_row, entity_name, channel]
        );

        applied++;
      }

      // Bulk catch-all: update any vendor_classifications rows whose financial_row
      // matches a GL prefix rule but were not covered by the loop above (e.g. rows
      // added to vendor_classifications outside of ingestion). Only touches rows
      // where manually_set = FALSE so user overrides are preserved.
      await client.query(`
        UPDATE vendor_classifications
           SET channel    = '${DNT}',
               is_preset  = TRUE,
               updated_at = NOW()
         WHERE financial_row ~ '^(54|55|60)[0-9]'
           AND manually_set = FALSE
           AND channel IS DISTINCT FROM '${DNT}'
      `);

      await client.query(`
        UPDATE vendor_classification_history
           SET channel   = '${DNT}',
               is_preset = TRUE
         WHERE financial_row ~ '^(54|55|60)[0-9]'
           AND manually_set = FALSE
           AND channel IS DISTINCT FROM '${DNT}'
      `);
    });

    return NextResponse.json({ ok: true, applied, gl_applied, total_pairs });
  } catch (err) {
    console.error('[api/vendor-classifications/apply-presets]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
