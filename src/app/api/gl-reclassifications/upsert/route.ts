import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as {
      financial_row: string;
      from_channel:  string;
      to_department: string;
      description?:  string;
    };
    if (!body.financial_row || !body.to_department) {
      return NextResponse.json({ error: 'financial_row and to_department are required' }, { status: 400 });
    }
    await execute(
      `INSERT INTO gl_reclassifications (financial_row, from_channel, to_department, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (financial_row) DO UPDATE
         SET from_channel  = EXCLUDED.from_channel,
             to_department = EXCLUDED.to_department,
             description   = EXCLUDED.description`,
      [body.financial_row, body.from_channel ?? '', body.to_department, body.description ?? null]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/gl-reclassifications/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
