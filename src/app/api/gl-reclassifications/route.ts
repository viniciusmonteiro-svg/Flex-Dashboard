import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET(req: NextRequest) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get('month_key');  // 'all' | YYYY-MM | null

    const params: unknown[] = [];
    let where = '';
    if (monthKey && monthKey !== 'all') {
      params.push(monthKey);
      where = `WHERE gr.month_key = $1`;
    }

    const rows = await query<{
      financial_row: string;
      entity_name:   string;
      month_key:     string | null;
      from_channel:  string;
      to_department: string;
      description:   string | null;
      total_spend:   string;
    }>(
      `SELECT
         gr.financial_row,
         gr.entity_name,
         gr.month_key,
         gr.from_channel,
         gr.to_department,
         gr.description,
         COALESCE(SUM(n.amount), 0) / 100 AS total_spend
       FROM gl_reclassifications gr
       LEFT JOIN netsuite_actuals n
              ON n.financial_row = gr.financial_row
             AND (gr.entity_name = '' OR n.entity_name = gr.entity_name)
             AND (gr.month_key IS NULL OR n.month_key = gr.month_key)
       ${where}
       GROUP BY gr.id, gr.financial_row, gr.entity_name, gr.month_key,
                gr.from_channel, gr.to_department, gr.description
       ORDER BY gr.financial_row, gr.entity_name, gr.month_key NULLS FIRST`,
      params
    );

    return NextResponse.json({
      reclassifications: rows.map((r) => ({
        financial_row: r.financial_row,
        entity_name:   r.entity_name,
        month_key:     r.month_key,
        from_channel:  r.from_channel,
        to_department: r.to_department,
        description:   r.description,
        total_spend:   Number(r.total_spend),
      })),
    });
  } catch (err) {
    console.error('[api/gl-reclassifications]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
