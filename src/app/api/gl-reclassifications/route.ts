import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  try {
    await initDb();
    const rows = await query<{
      financial_row: string;
      from_channel:  string;
      to_department: string;
      description:   string | null;
      total_spend:   string;
    }>(
      `SELECT
         gr.financial_row,
         gr.from_channel,
         gr.to_department,
         gr.description,
         COALESCE(SUM(n.amount), 0) / 100 AS total_spend
       FROM gl_reclassifications gr
       LEFT JOIN netsuite_actuals n ON n.financial_row = gr.financial_row
       GROUP BY gr.id, gr.financial_row, gr.from_channel, gr.to_department, gr.description
       ORDER BY gr.financial_row`
    );
    return NextResponse.json({
      reclassifications: rows.map((r) => ({
        financial_row: r.financial_row,
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
