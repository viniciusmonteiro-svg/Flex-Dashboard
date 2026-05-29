import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { buildPeriodExpr } from '@/lib/periodExpr';

export interface VendorClassificationRow {
  financial_row: string;
  entity_name: string;
  has_name: boolean;       // false when col G (Name) was blank → show "-Unassigned-" in UI
  channel: string;         // month-aware active channel
  current_channel: string; // always from vendor_classifications (for diff indicator)
  is_preset: boolean;
  manually_set: boolean;
  updated_at: string | null;
  total_amount: number;
  months_active: number;
  description: string | null;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    // selectedPeriod is the YYYY-MM value the user picked in the month dropdown.
    // It was derived using the current period_type, so we apply it with the same
    // period expression here.
    const selectedPeriod = searchParams.get('month_key')   ?? null;
    const periodType     = searchParams.get('period_type') ?? 'transaction';

    const PERIOD = buildPeriodExpr(periodType);

    // For the classification history join we still use the raw month_key stored
    // in vendor_classification_history (always the filename-derived month).
    // Since accounting_period ≈ month_key for our data (same calendar month),
    // joining vch on the selected period works for both modes.
    const rows = await query<{
      financial_row: string;
      entity_name: string;
      has_name: boolean;
      channel: string;
      current_channel: string;
      is_preset: boolean;
      manually_set: boolean;
      updated_at: string | null;
      total_amount: string;
      months_active: string;
      description: string | null;
    }>(
      // Spend filter: when a period is selected, only rows whose derived period
      // matches are included — so SUM(amount) and months_active reflect that slice.
      //
      // Classification joins:
      //   vch     — history for the SELECTED month only (channel/flags for that period)
      //   vch_any — aggregated across ALL months (drives manually_set + updated_at when
      //             no month is selected or when vc has no manual record)
      //
      // updated_at priority:
      //   1. This month's manual history timestamp (viewing a specific month)
      //   2. Global vendor_classifications timestamp (globally classified)
      //   3. Most recent manual timestamp across any month (month-specific classifs)
      `SELECT
         n.financial_row,
         n.entity_name,
         BOOL_AND(n.has_name)                                                           AS has_name,
         COALESCE(vc.channel,                                          'Unclassified')  AS current_channel,
         COALESCE(vch.channel, vc.channel,                            'Unclassified')  AS channel,
         COALESCE(vch.is_preset,    vc.is_preset,   FALSE)                             AS is_preset,
         COALESCE(vch.manually_set, vc.manually_set, vch_any.any_manually_set, FALSE)  AS manually_set,
         COALESCE(
           CASE WHEN vch.manually_set THEN COALESCE(vch.updated_at, vch.created_at) END,
           CASE WHEN vc.manually_set  THEN vc.updated_at END,
           vch_any.last_manual_at
         )                                                                              AS updated_at,
         SUM(n.amount)                                                                  AS total_amount,
         COUNT(DISTINCT ${PERIOD})                                                      AS months_active,
         MAX(n.description)                                                             AS description
       FROM netsuite_actuals n
       LEFT JOIN vendor_classifications vc
              ON vc.financial_row = n.financial_row
             AND vc.entity_name   = n.entity_name
       LEFT JOIN vendor_classification_history vch
              ON vch.financial_row = n.financial_row
             AND vch.entity_name   = n.entity_name
             AND vch.month_key     = $1
       LEFT JOIN (
         SELECT
           financial_row,
           entity_name,
           BOOL_OR(manually_set)                                                    AS any_manually_set,
           MAX(CASE WHEN manually_set THEN COALESCE(updated_at, created_at) END)    AS last_manual_at
         FROM vendor_classification_history
         GROUP BY financial_row, entity_name
       ) vch_any ON vch_any.financial_row = n.financial_row
                AND vch_any.entity_name   = n.entity_name
       WHERE ($1::text IS NULL OR ${PERIOD} = $1)
       GROUP BY n.financial_row, n.entity_name,
                vc.channel, vc.is_preset, vc.manually_set, vc.updated_at,
                vch.channel, vch.is_preset, vch.manually_set, vch.updated_at, vch.created_at,
                vch_any.any_manually_set, vch_any.last_manual_at
       ORDER BY SUM(n.amount) DESC`,
      [selectedPeriod]
    );

    const mapped: VendorClassificationRow[] = rows.map((r) => ({
      financial_row:   r.financial_row,
      entity_name:     r.entity_name,
      has_name:        r.has_name,
      channel:         r.channel,
      current_channel: r.current_channel,
      is_preset:       r.is_preset,
      manually_set:    r.manually_set,
      updated_at:      r.updated_at ?? null,
      total_amount:    Number(r.total_amount) / 100,
      months_active:   Number(r.months_active),
      description:     r.description ?? null,
    }));

    return NextResponse.json({ rows: mapped });
  } catch (err) {
    console.error('[api/vendor-classifications]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
