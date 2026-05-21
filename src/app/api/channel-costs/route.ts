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
    const channelParam  = searchParams.get('channel')   || 'all';
    const yearParam     = searchParams.get('year')      || 'all';
    const monthKeyParam = searchParams.get('month_key') || null;
    const isAllChannels = !channelParam || channelParam === 'all';
    const yearFilter    = yearParam && yearParam !== 'all' ? yearParam : null;

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (isAllChannels) {
      conditions.push(`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`);
    } else {
      params.push(channelParam);
      conditions.push(`${CHANNEL_EXPR} = $${params.length}`);
    }

    if (monthKeyParam) {
      params.push(monthKeyParam);
      conditions.push(`n.month_key = $${params.length}`);
    } else if (yearFilter) {
      params.push(yearFilter);
      conditions.push(`LEFT(n.month_key, 4) = $${params.length}`);
    }

    const whereClause  = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const channelSelect = isAllChannels ? `${CHANNEL_EXPR} AS channel,` : '';
    const channelGroup  = isAllChannels ? `${CHANNEL_EXPR},` : '';
    const channelOrder  = isAllChannels ? `${CHANNEL_EXPR},` : '';

    const rawRows = await query<RawRow>(
      `SELECT ${channelSelect} n.financial_row, n.entity_name, n.month_key,
              SUM(n.amount) / 100 AS amount
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       ${whereClause}
       GROUP BY ${channelGroup} n.financial_row, n.entity_name, n.month_key
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
