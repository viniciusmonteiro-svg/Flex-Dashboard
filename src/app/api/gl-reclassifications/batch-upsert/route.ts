import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';
import { getPoolInstance } from '@/db/connection';

interface GlBatchChange {
  financial_row: string;
  entity_name:   string;
  month_key:     string | null;
  to_department: string;   // '' = remove reclassification (keep in marketing)
  from_channel:  string;
  description:   string | null;
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const { changes } = await req.json() as { changes: GlBatchChange[] };
    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: 'changes array is required' }, { status: 400 });
    }

    const pool = getPoolInstance();
    const client = await pool.connect();
    let saved = 0;

    try {
      await client.query('BEGIN');
      for (const c of changes) {
        // Always delete existing entry for this (financial_row, entity_name, month_key)
        await client.query(
          `DELETE FROM gl_reclassifications
           WHERE financial_row = $1
             AND entity_name   = $2
             AND month_key IS NOT DISTINCT FROM $3`,
          [c.financial_row, c.entity_name, c.month_key]
        );
        // '' means "keep in marketing" → delete only, no insert
        if (c.to_department !== '') {
          await client.query(
            `INSERT INTO gl_reclassifications
               (financial_row, entity_name, month_key, from_channel, to_department, description)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [c.financial_row, c.entity_name, c.month_key, c.from_channel, c.to_department, c.description]
          );
        }
        saved++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error('[api/gl-reclassifications/batch-upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
