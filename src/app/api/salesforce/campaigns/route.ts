import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export interface CampaignRow {
  campaign_source: string;   // now sourced from primary_campaign_name
  created_month: string;
  closed_won: number;
  total_opportunities: number;
  total_mrr: number;
}

/**
 * Maps display-layer channel labels (as shown in the UI / returned by the
 * channels API) back to the raw primary_channel values stored in the DB.
 * Mirrors CHANNEL_LABEL_MAP in /api/salesforce/channels/route.ts — keep in sync.
 */
const DISPLAY_TO_RAW: Record<string, string[]> = {
  'Paid Search':        ['Web Paid'],
  'SEO / Organic':      ['Web Organic'],
  'Paid Social':        ['Social Media'],
  'Partner / Referral': ['Referral', 'Partner'],
  'Other':              ['Web Other'],
};

/** Expand a display label to the raw DB values it covers. */
function rawChannels(displayLabel: string): string[] {
  return DISPLAY_TO_RAW[displayLabel] ?? [displayLabel];
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);

    const from    = searchParams.get('from')    ?? null;  // YYYY-MM inclusive, or null for no lower bound
    const to      = searchParams.get('to')      ?? null;  // YYYY-MM inclusive, or null for no upper bound
    const channel = searchParams.get('channel') ?? 'all';

    const channelRaws = channel === 'all' ? [] : rawChannels(channel);

    // $1 = from  (text | null) — NULL means no lower bound
    // $2 = to    (text | null) — NULL means no upper bound
    // $3 = isAllChannels (boolean)
    // $4 = channelRaws  (text[])
    const rows = await query<{
      campaign_source:     string;
      created_month:       string;
      closed_won:          string;
      total_opportunities: string;
      total_mrr:           string;
    }>(
      `SELECT
         COALESCE(NULLIF(TRIM(primary_campaign_name), ''), '(no campaign)') AS campaign_source,
         created_month,
         COUNT(*) FILTER (WHERE stage = 'Closed Won')  AS closed_won,
         COUNT(*)                                       AS total_opportunities,
         COALESCE(SUM(monthly_mrr), 0)                 AS total_mrr
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
         AND ($1::text IS NULL OR created_month >= $1)
         AND ($2::text IS NULL OR created_month <= $2)
         AND ($3::boolean OR
              COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') = ANY($4::text[]))
       GROUP BY 1, 2
       ORDER BY created_month DESC, closed_won DESC`,
      [from, to, channel === 'all', channelRaws]
    );

    const mapped: CampaignRow[] = rows.map((r) => ({
      campaign_source:     r.campaign_source,
      created_month:       r.created_month,
      closed_won:          Number(r.closed_won),
      total_opportunities: Number(r.total_opportunities),
      total_mrr:           Number(r.total_mrr) / 100,
    }));

    return NextResponse.json({ from, to, rows: mapped });
  } catch (err) {
    console.error('[api/salesforce/campaigns]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
