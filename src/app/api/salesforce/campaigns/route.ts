import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export interface CampaignRow {
  campaign_source: string;
  created_month: string;
  closed_won: number;
  total_opportunities: number;
  total_mrr: number;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month') ?? 'all';
    const channel = searchParams.get('channel') ?? 'all';

    const rows = await query<{
      campaign_source: string;
      created_month: string;
      closed_won: string;
      total_opportunities: string;
      total_mrr: string;
    }>(
      `SELECT
         COALESCE(NULLIF(TRIM(primary_campaign_source), ''), '(no campaign)') AS campaign_source,
         created_month,
         COUNT(*) FILTER (WHERE stage = 'Closed Won') AS closed_won,
         COUNT(*)                                     AS total_opportunities,
         COALESCE(SUM(monthly_mrr), 0)                AS total_mrr
       FROM salesforce_opportunities
       WHERE ($1::text = 'all' OR created_month = $1)
         AND ($2::text = 'all' OR COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') = $2)
         AND created_month IS NOT NULL AND created_month != ''
       GROUP BY 1, 2
       ORDER BY created_month DESC, closed_won DESC`,
      [month, channel]
    );

    const mapped: CampaignRow[] = rows.map((r) => ({
      campaign_source: r.campaign_source,
      created_month: r.created_month,
      closed_won: Number(r.closed_won),
      total_opportunities: Number(r.total_opportunities),
      total_mrr: Number(r.total_mrr) / 100,
    }));

    return NextResponse.json({ rows: mapped });
  } catch (err) {
    console.error('[api/salesforce/campaigns]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
