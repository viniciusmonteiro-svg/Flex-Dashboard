import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';
import { buildPeriodExpr } from '@/lib/periodExpr';

interface RawRow {
  channel?: string;
  financial_row: string;
  entity_name: string;
  month_key: string; // contains the resolved period, not necessarily the raw filename month
  amount: string;
}

export interface ChannelDetailRow {
  channel?: string;
  financial_row: string;
  entity_name: string;
  month_key: string;
  amount: number;
}

export interface ChannelDetailResponse {
  rows: ChannelDetailRow[];
  years: string[];
}

const EXCLUDED = `('Do Not Tag (COGS/Non-S&M)', 'Unclassified')`;

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const channelParam  = searchParams.get('channel')      || 'all';
    const periodType    = searchParams.get('period_type')  || 'transaction';
    // from/to are preferred; year/month_key kept for backwards-compat
    const fromParam     = searchParams.get('from')         || null;
    const toParam       = searchParams.get('to')           || null;
    const yearParam     = searchParams.get('year')         || 'all';
    const monthKeyParam = searchParams.get('month_key')    || null;

    const isAllChannels = !channelParam || channelParam === 'all';
    const yearFilter    = yearParam && yearParam !== 'all' ? yearParam : null;

    // The SQL expression that resolves a YYYY-MM period for each row.
    // All grouping, filtering, and the returned "month_key" use this expression
    // so the client always works with consistent period labels.
    const PERIOD = buildPeriodExpr(periodType);

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (isAllChannels) {
      conditions.push(`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`);
    } else if (channelParam === 'Referral/Partner') {
      conditions.push(`${CHANNEL_EXPR} IN ('Referral', 'Partner')`);
    } else {
      params.push(channelParam);
      conditions.push(`${CHANNEL_EXPR} = $${params.length}`);
    }

    // Period-aware filtering
    if (fromParam) {
      params.push(fromParam);
      conditions.push(`${PERIOD} >= $${params.length}`);
    }
    if (toParam) {
      params.push(toParam);
      conditions.push(`${PERIOD} <= $${params.length}`);
    }
    if (!fromParam && !toParam) {
      if (monthKeyParam) {
        params.push(monthKeyParam);
        conditions.push(`${PERIOD} = $${params.length}`);
      } else if (yearFilter) {
        params.push(yearFilter);
        conditions.push(`LEFT(${PERIOD}, 4) = $${params.length}`);
      }
    }

    const whereClause   = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const channelSelect = isAllChannels ? `${CHANNEL_EXPR} AS channel,` : '';
    const channelGroup  = isAllChannels ? `${CHANNEL_EXPR},` : '';
    const channelOrder  = isAllChannels ? `${CHANNEL_EXPR},` : '';

    const rawRows = await query<RawRow>(
      `SELECT ${channelSelect} n.financial_row, n.entity_name,
              ${PERIOD} AS month_key,
              SUM(n.amount) / 100 AS amount
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       ${whereClause}
       GROUP BY ${channelGroup} n.financial_row, n.entity_name, ${PERIOD}
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
