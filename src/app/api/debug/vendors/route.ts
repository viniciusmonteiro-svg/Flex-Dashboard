import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  await initDb();

  const [vendors, financialRows] = await Promise.all([
    query<{ entity_name: string; row_count: string; total_dollars: string }>(
      `SELECT
         entity_name,
         COUNT(*)             AS row_count,
         SUM(amount) / 100.0  AS total_dollars
       FROM netsuite_actuals
       GROUP BY entity_name
       ORDER BY total_dollars DESC`
    ),
    query<{ financial_row: string; row_count: string; total_dollars: string }>(
      `SELECT
         financial_row,
         COUNT(*)             AS row_count,
         SUM(amount) / 100.0  AS total_dollars
       FROM netsuite_actuals
       GROUP BY financial_row
       ORDER BY total_dollars DESC`
    ),
  ]);

  return NextResponse.json({
    entity_names: vendors.map((r) => ({
      entity_name: r.entity_name,
      row_count: Number(r.row_count),
      total_dollars: Number(r.total_dollars),
    })),
    financial_rows: financialRows.map((r) => ({
      financial_row: r.financial_row,
      row_count: Number(r.row_count),
      total_dollars: Number(r.total_dollars),
    })),
  });
}
