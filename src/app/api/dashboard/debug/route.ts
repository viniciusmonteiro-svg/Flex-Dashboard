import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

/**
 * Debug endpoint — audits the salesforce_opportunities table.
 *
 * GET /api/dashboard/debug
 *
 * Returns:
 *  - total row count
 *  - how many have a valid created_month vs empty/null
 *  - order_type distribution
 *  - sample of rows with missing created_month so you can diagnose the source
 */
export async function GET() {
  try {
    await initDb();

    // Row count by created_month presence
    const [countRow] = await query<{
      total: string;
      valid_month: string;
      empty_month: string;
    }>(
      `SELECT
         COUNT(*)                                                         AS total,
         COUNT(*) FILTER (WHERE created_month IS NOT NULL AND created_month != '') AS valid_month,
         COUNT(*) FILTER (WHERE created_month IS NULL OR created_month = '')       AS empty_month
       FROM salesforce_opportunities`
    );

    // order_type distribution
    const orderTypeRows = await query<{ order_type: string | null; count: string }>(
      `SELECT order_type, COUNT(*) AS count
       FROM salesforce_opportunities
       GROUP BY order_type
       ORDER BY count DESC`
    );

    // Sample of rows with missing created_month — show their raw created_date
    const missingMonthSample = await query<{
      opportunity_id: string;
      created_date: string | null;
      created_month: string | null;
    }>(
      `SELECT opportunity_id, created_date::text, created_month
       FROM salesforce_opportunities
       WHERE created_month IS NULL OR created_month = ''
       LIMIT 20`
    );

    const distribution = orderTypeRows.map((r) => ({
      order_type: r.order_type,
      count: Number(r.count),
    }));

    const total      = Number(countRow.total);
    const validMonth = Number(countRow.valid_month);
    const emptyMonth = Number(countRow.empty_month);

    return NextResponse.json({
      total_rows:          total,
      valid_created_month: validMonth,
      empty_created_month: emptyMonth,
      pct_valid:           total > 0 ? `${((validMonth / total) * 100).toFixed(1)}%` : '0%',
      order_type_distribution: distribution,
      missing_month_sample: missingMonthSample,
    });
  } catch (err) {
    console.error('[api/dashboard/debug]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
