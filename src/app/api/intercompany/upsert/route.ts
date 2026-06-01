import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as {
      financial_row:    string;
      entity_name:      string;
      marketing_pct:    number;
      other_department: string;
      other_pct:        number;
      valid_from?:      string | null;
      valid_to?:        string | null;
      description?:     string | null;
    };

    if (!body.financial_row || !body.entity_name) {
      return NextResponse.json({ error: 'financial_row and entity_name are required' }, { status: 400 });
    }
    const mktPct   = Number(body.marketing_pct);
    const otherPct = Number(body.other_pct);
    if (Math.abs(mktPct + otherPct - 100) > 0.01) {
      return NextResponse.json({ error: 'marketing_pct + other_pct must equal 100' }, { status: 400 });
    }

    // Remove existing entry for same (financial_row, entity_name, valid_from) before inserting
    // Using IS NOT DISTINCT FROM to handle NULL valid_from comparisons
    await execute(
      `DELETE FROM intercompany_allocations
       WHERE financial_row = $1
         AND entity_name   = $2
         AND valid_from IS NOT DISTINCT FROM $3`,
      [body.financial_row, body.entity_name, body.valid_from ?? null]
    );
    await execute(
      `INSERT INTO intercompany_allocations
         (financial_row, entity_name, marketing_pct, other_department, other_pct,
          valid_from, valid_to, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        body.financial_row, body.entity_name, mktPct, body.other_department, otherPct,
        body.valid_from ?? null, body.valid_to ?? null, body.description ?? null,
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/intercompany/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
