import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { getPoolInstance } from '@/db/connection';

interface IcBatchChange {
  financial_row:    string;
  entity_name:      string;
  old_valid_from:   string | null;   // key for deletion of the previous entry
  marketing_pct:    number;
  other_department: string;
  other_pct:        number;
  valid_from:       string | null;
  valid_to:         string | null;
  description:      string | null;
  delete?:          boolean;         // true when marketing_pct = 100 (remove split)
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const { changes } = await req.json() as { changes: IcBatchChange[] };
    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: 'changes array is required' }, { status: 400 });
    }

    const pool   = getPoolInstance();
    const client = await pool.connect();
    let saved = 0;

    try {
      await client.query('BEGIN');
      for (const c of changes) {
        // Delete the previous record identified by (financial_row, entity_name, old_valid_from)
        await client.query(
          `DELETE FROM intercompany_allocations
           WHERE financial_row = $1
             AND entity_name   = $2
             AND valid_from IS NOT DISTINCT FROM $3`,
          [c.financial_row, c.entity_name, c.old_valid_from]
        );
        // If delete flag or marketing_pct = 100: don't insert, just remove the split
        if (!c.delete && c.marketing_pct < 100) {
          if (Math.abs(c.marketing_pct + c.other_pct - 100) > 0.01) {
            throw new Error(`marketing_pct + other_pct must equal 100 for ${c.entity_name}`);
          }
          await client.query(
            `INSERT INTO intercompany_allocations
               (financial_row, entity_name, marketing_pct, other_department, other_pct,
                valid_from, valid_to, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [c.financial_row, c.entity_name, c.marketing_pct, c.other_department, c.other_pct,
             c.valid_from, c.valid_to, c.description]
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
    console.error('[api/intercompany/batch-upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
