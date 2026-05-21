import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';

interface RawRow {
  channel?: string;
  financial_row: string;
  entity_name: string;
  month_key: string;
  amount: string;
}

export interface ChannelDetailRow {
  channel?: string;
  financial_row: string;
  entity_name: string;
  month_key: string; // the resolved period (accounting or transaction), not always the filename month
  amount: number;
}

export interface ChannelDetailResponse {
  rows: ChannelDetailRow[];
  years: string[];
}

const EXCLUDED = `('Do Not Tag (COGS/Non-S&M)', 'Unclassified')`;

/**
 * Build the SQL expression used to derive the "period" for grouping and filtering.
 *
 * accounting (default): use the NetSuite accounting period column, fall back to
 *   the filename-derived month_key when accounting_period is NULL (e.g. old-format files).
 *
 * transaction: use the calendar month of the transaction date, fall back to
 *   filename month_key when transaction_date is NULL.
 */
function buildPeriodExpr(periodType: string): string {
  if (periodType === 'transaction') {
    return `COALESCE(LEFT(n.transaction_date::text, 7), n.month_key)`;
  }
  // Default: 'accounting'
  return `COALESCE(n.accounting_period, n.month_key)`;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const channelParam  = searchParams.get('channel')      || 'all';
    const yearParam     = searchParams.get('year')         || 'all';
    const monthKeyParam = searchParams.get('month_key')    || null;
    const periodType    = searchParams.get('period_type')  || 'accounting';

    const isAllChannels = !channelParam || channelParam === 'all';
    const yearFilter    = yearParam && yearParam !== 'all' ? yearParam : null;

    const PERIOD_EXPR = buildPeriodExpr(periodType);

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (isAllChannels) {
      conditions.push(`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`);
    } else {
      params.push(channelParam);
      conditions.push(`${CHANNEL_EXPR} = $${params.length}`);
    }

    // Filter by period (uses the same PERIOD_EXPR so accounting and transaction modes
    // each see the correct slice when a specific month or year is selected)
    if (monthKeyParam) {
      params.push(monthKeyParam);
      conditions.push(`${PERIOD_EXPR} = $${params.length}`);
    } else if (yearFilter) {
      params.push(yearFilter);
      conditions.push(`LEFT(${PERIOD_EXPR}, 4) = $${params.length}`);
    }

    const whereClause  = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const channelSelect = isAllChannels ? `${CHANNEL_EXPR} AS channel,` : '';
    const channelGroup  = isAllChannels ? `${CHANNEL_EXPR},` : '';
    const channelOrder  = isAllChannels ? `${CHANNEL_EXPR},` : '';

    const rawRows = await query<RawRow>(
      `SELECT ${channelSelect} n.financial_row, n.entity_name,
              ${PERIOD_EXPR} AS month_key,
              SUM(n.amount) / 100 AS amount
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       ${whereClause}
       GROUP BY ${channelGroup} n.financial_row, n.entity_name, ${PERIOD_EXPR}
       ORDER BY ${channelOrder} n.financial_row, amount DESC`,
      params
    );

    const rows: ChannelDetailRow[] = rawRows.map((r) => ({
      ...(r.channel ? { channel: r.channel } : {}),
      financial_row: r.financial_row,
      entity_name:   r.entity_name,
      month_key:     r.month_key,
      amount:        Number(r.amount),
    }));

    const yearSet = new Set<string>();
    rows.forEach((r) => yearSet.add(r.month_key.slice(0, 4)));
    const years = [...yearSet].sort();

    return NextResponse.json({ rows, years } satisfies ChannelDetailResponse);
  } catch (err) {
    console.error('[api/channel-costs]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
