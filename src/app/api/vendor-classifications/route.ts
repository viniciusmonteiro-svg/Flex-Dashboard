import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export interface VendorClassificationRow {
  financial_row: string;
  entity_name: string;
  channel: string;
  is_preset: boolean;
  manually_set: boolean;
  total_amount: number;
  months_active: number;
}

export async function GET() {
  try {
    await initDb();

    const rows = await query<{
      financial_row: string;
      entity_name: string;
      channel: string;
      is_preset: boolean;
      manually_set: boolean;
      total_amount: string;
      months_active: string;
    }>(
      `SELECT
         n.financial_row,
         n.entity_name,
         COALESCE(vc.channel,      'Unclassified') AS channel,
         COALESCE(vc.is_preset,    FALSE)           AS is_preset,
         COALESCE(vc.manually_set, FALSE)           AS manually_set,
         SUM(n.amount)                              AS total_amount,
         COUNT(DISTINCT n.month_key)                AS months_active
       FROM netsuite_actuals n
       LEFT JOIN vendor_classifications vc
              ON vc.financial_row = n.financial_row
             AND vc.entity_name   = n.entity_name
       GROUP BY n.financial_row, n.entity_name, vc.channel, vc.is_preset, vc.manually_set
       ORDER BY SUM(n.amount) DESC`
    );

    const mapped: VendorClassificationRow[] = rows.map((r) => ({
      financial_row: r.financial_row,
      entity_name: r.entity_name,
      channel: r.channel,
      is_preset: r.is_preset,
      manually_set: r.manually_set,
      total_amount: Number(r.total_amount) / 100,
      months_active: Number(r.months_active),
    }));

    return NextResponse.json({ rows: mapped });
  } catch (err) {
    console.error('[api/vendor-classifications]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
