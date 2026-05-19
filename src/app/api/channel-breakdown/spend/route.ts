import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

type View = 'monthly' | 'quarterly' | 'yearly';

interface RawRow {
  channel: string;
  month_key: string;
  total_amount: string;
}

function monthKeyToPeriod(monthKey: string, view: View): string {
  const year = monthKey.slice(0, 4);
  const month = parseInt(monthKey.slice(5, 7), 10);
  if (view === 'yearly') return year;
  if (view === 'quarterly') return `Q${Math.ceil(month / 3)} ${year}`;
  // monthly — "Jan 2026"
  return new Date(parseInt(year), month - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function sortPeriods(periods: string[], view: View): string[] {
  return [...periods].sort((a, b) => {
    if (view === 'yearly') return a.localeCompare(b);
    if (view === 'quarterly') {
      // "Q2 2025" -> sortable: "2025Q2"
      const toKey = (s: string) => `${s.slice(3)}${s.slice(0, 2)}`;
      return toKey(a).localeCompare(toKey(b));
    }
    // monthly: "Jan 2026" -> parse back to date
    return new Date(a).getTime() - new Date(b).getTime();
  });
}

export interface SpendResponse {
  channels: string[];
  periods: string[];
  years: string[];
  rows: {
    channel: string;
    values: number[];
    total: number;
  }[];
  subtotal: number[];
  grand_total: number;
}

const EXCLUDED = `('Do Not Tag (COGS/Non-S&M)', 'Unclassified')`;

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const view = (searchParams.get('view') ?? 'quarterly') as View;
    const year = searchParams.get('year') ?? 'all';

    const yearClause = year !== 'all' ? `AND n.month_key LIKE $1 || '-%'` : '';
    const params: string[] = year !== 'all' ? [year] : [];

    const rawRows = await query<RawRow>(
      `SELECT
         vc.channel,
         n.month_key,
         SUM(n.amount) AS total_amount
       FROM netsuite_actuals n
       JOIN vendor_classifications vc
         ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
       WHERE vc.channel NOT IN ${EXCLUDED}
         ${yearClause}
       GROUP BY vc.channel, n.month_key
       ORDER BY vc.channel, n.month_key`,
      params
    );

    // Collect all distinct years for the dropdown
    const yearSet = new Set<string>();
    rawRows.forEach((r) => yearSet.add(r.month_key.slice(0, 4)));
    const years = [...yearSet].sort();

    // Map month_key → period label
    const periodSet = new Set<string>();
    const channelSet = new Set<string>();

    // channel -> period -> amount (dollars)
    const matrix: Record<string, Record<string, number>> = {};

    for (const r of rawRows) {
      const period = monthKeyToPeriod(r.month_key, view);
      const amount = Number(r.total_amount) / 100;
      channelSet.add(r.channel);
      periodSet.add(period);
      if (!matrix[r.channel]) matrix[r.channel] = {};
      matrix[r.channel][period] = (matrix[r.channel][period] ?? 0) + amount;
    }

    const periods = sortPeriods([...periodSet], view);
    const channels = [...channelSet].sort();

    const rows = channels.map((channel) => {
      const values = periods.map((p) => matrix[channel]?.[p] ?? 0);
      const total = values.reduce((s, v) => s + v, 0);
      return { channel, values, total };
    });

    const subtotal = periods.map((_, i) =>
      rows.reduce((s, r) => s + r.values[i], 0)
    );
    const grand_total = subtotal.reduce((s, v) => s + v, 0);

    return NextResponse.json({ channels, periods, years, rows, subtotal, grand_total } satisfies SpendResponse);
  } catch (err) {
    console.error('[api/channel-breakdown/spend]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
