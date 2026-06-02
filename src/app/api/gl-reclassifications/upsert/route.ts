import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as {
      financial_row: string;
      entity_name?:  string;
      month_key?:    string | null;
      from_channel:  string;
      to_department: string;
      description?:  string;
    };
    if (!body.financial_row || !body.to_department) {
      return NextResponse.json({ error: 'financial_row and to_department are required' }, { status: 400 });
    }

    const monthKey    = body.month_key    ?? null;
    const entityName  = body.entity_name  ?? '';

    await execute(
      `DELETE FROM gl_reclassifications
       WHERE financial_row = $1
         AND entity_name   = $2
         AND month_key IS NOT DISTINCT FROM $3`,
      [body.financial_row, entityName, monthKey]
    );
    await execute(
      `INSERT INTO gl_reclassifications (financial_row, entity_name, month_key, from_channel, to_department, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [body.financial_row, entityName, monthKey, body.from_channel ?? '', body.to_department, body.description ?? null]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/gl-reclassifications/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
