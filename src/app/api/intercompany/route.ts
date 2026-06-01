import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  try {
    await initDb();
    const rows = await query<{
      id:               number;
      financial_row:    string;
      entity_name:      string;
      marketing_pct:    string;
      other_department: string;
      other_pct:        string;
      valid_from:       string | null;
      valid_to:         string | null;
      description:      string | null;
      total_spend:      string;
    }>(
      `SELECT
         ia.id,
         ia.financial_row,
         ia.entity_name,
         ia.marketing_pct,
         ia.other_department,
         ia.other_pct,
         ia.valid_from,
         ia.valid_to,
         ia.description,
         COALESCE(SUM(n.amount * ia.marketing_pct / 100.0), 0) / 100 AS total_spend
       FROM intercompany_allocations ia
       LEFT JOIN netsuite_actuals n
              ON n.financial_row = ia.financial_row
             AND n.entity_name   = ia.entity_name
       GROUP BY ia.id
       ORDER BY ia.entity_name, ia.financial_row`
    );
    return NextResponse.json({
      allocations: rows.map((r) => ({
        id:               Number(r.id),
        financial_row:    r.financial_row,
        entity_name:      r.entity_name,
        marketing_pct:    Number(r.marketing_pct),
        other_department: r.other_department,
        other_pct:        Number(r.other_pct),
        valid_from:       r.valid_from,
        valid_to:         r.valid_to,
        description:      r.description,
        total_spend:      Number(r.total_spend),
      })),
    });
  } catch (err) {
    console.error('[api/intercompany]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
