import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export interface VendorClassificationRow {
  financial_row: string;
  entity_name: string;
  channel: string;         // month-aware active channel
  current_channel: string; // always from vendor_classifications (for diff indicator)
  is_preset: boolean;
  manually_set: boolean;
  updated_at: string | null;
  total_amount: number;
  months_active: number;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const monthKey = new URL(req.url).searchParams.get('month_key') ?? null;

    const rows = await query<{
      financial_row: string;
      entity_name: string;
      channel: string;
      current_channel: string;
      is_preset: boolean;
      manually_set: boolean;
      updated_at: string | null;
      total_amount: string;
      months_active: string;
    }>(
      // History mode ($1 IS NOT NULL): filter actuals to the selected month so
      //   SUM(amount) and COUNT(DISTINCT month_key) reflect that period only.
      //   vch join on $1 picks the month-specific classification.
      // Current mode ($1 IS NULL): no WHERE filter → all months aggregated.
      //   vch join condition (month_key = NULL) never matches, so COALESCE falls
      //   back to vc.channel — the canonical all-time classification.
      `SELECT
         n.financial_row,
         n.entity_name,
         COALESCE(vc.channel,                       'Unclassified') AS current_channel,
         COALESCE(vch.channel, vc.channel,          'Unclassified') AS channel,
         COALESCE(vch.is_preset,    vc.is_preset,   FALSE)          AS is_preset,
         COALESCE(vch.manually_set, vc.manually_set, FALSE)         AS manually_set,
         vc.updated_at,
         SUM(n.amount)                                              AS total_amount,
         COUNT(DISTINCT n.month_key)                                AS months_active
       FROM netsuite_actuals n
       LEFT JOIN vendor_classifications vc
              ON vc.financial_row = n.financial_row
             AND vc.entity_name   = n.entity_name
       LEFT JOIN vendor_classification_history vch
              ON vch.financial_row = n.financial_row
             AND vch.entity_name   = n.entity_name
             AND vch.month_key     = $1
       WHERE ($1::text IS NULL OR n.month_key = $1)
       GROUP BY n.financial_row, n.entity_name,
                vc.channel, vc.is_preset, vc.manually_set, vc.updated_at,
                vch.channel, vch.is_preset, vch.manually_set
       ORDER BY SUM(n.amount) DESC`,
      [monthKey]
    );

    const mapped: VendorClassificationRow[] = rows.map((r) => ({
      financial_row: r.financial_row,
      entity_name: r.entity_name,
      channel: r.channel,
      current_channel: r.current_channel,
      is_preset: r.is_preset,
      manually_set: r.manually_set,
      updated_at: r.updated_at ?? null,
      total_amount: Number(r.total_amount) / 100,
      months_active: Number(r.months_active),
    }));

    return NextResponse.json({ rows: mapped });
  } catch (err) {
    console.error('[api/vendor-classifications]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
