import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { formatMonthShort } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'monthly' | 'quarterly' | 'yearly';

export interface ChannelBreakdown {
  channel:       string;
  opportunities: number;
  demoed:        number;
  new_business:  number;
  upsell:        number;
}

export interface KpiTrend {
  period:     string;
  value:      number;
  by_channel: ChannelBreakdown[];
}

export interface KpiItem {
  current: number;
  trend:   KpiTrend[];
}

export interface KpiResponse {
  periods: string[];
  kpis: {
    opportunities:   KpiItem;
    demoed:          KpiItem;
    new_business:    KpiItem;
    upsell:          KpiItem;
    show_rate:       KpiItem;
    demo_conversion: KpiItem;
    cohort_win_rate: KpiItem;
  };
}

// ─── Period helpers ───────────────────────────────────────────────────────────

/** Same bucketing but applied to close_date → YYYY-MM string */
function closeDatePeriodExpr(view: View): string {
  const m = `TO_CHAR(close_date, 'YYYY-MM')`;
  if (view === 'quarterly') return `LEFT(${m}, 4) || '-Q' || CEIL(RIGHT(${m}, 2)::int / 3.0)::int`;
  if (view === 'yearly')    return `LEFT(${m}, 4)`;
  return m;
}

function periodGroupExpr(view: View): string {
  if (view === 'quarterly') {
    return `LEFT(created_month, 4) || '-Q' ||
            CEIL(RIGHT(created_month, 2)::int / 3.0)::int`;
  }
  if (view === 'yearly') {
    return `LEFT(created_month, 4)`;
  }
  return `created_month`;
}

function periodDisplayLabel(key: string, view: View): string {
  if (view === 'quarterly') {
    // "2025-Q1" → "Q1 2025"
    const [yr, q] = key.split('-');
    return `${q} ${yr}`;
  }
  if (view === 'yearly') {
    return key;
  }
  return formatMonthShort(key); // "Jan 25"
}

// ─── Compute from/to defaults ─────────────────────────────────────────────────

function addMonthsKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function resolveRange(
  from: string | null,
  to:   string | null,
  quickRange: string
): Promise<{ from: string | null; to: string | null }> {
  if (from && to) return { from, to };

  const [latestRow] = await query<{ m: string }>(
    `SELECT MAX(created_month) AS m
     FROM salesforce_opportunities
     WHERE created_month IS NOT NULL AND created_month != ''`
  );
  const latest = latestRow?.m ?? '';
  if (!latest) return { from: null, to: null };

  const resolvedTo = to ?? latest;

  if (!from) {
    if (quickRange === 'all') return { from: null, to: resolvedTo };
    const delta = quickRange === '12m' ? -11 : quickRange === '24m' ? -23 : -5; // default 6m
    return { from: addMonthsKey(resolvedTo, delta), to: resolvedTo };
  }

  return { from, to: resolvedTo };
}

// ─── Channel mapping (mirrors SalesforceClient / channel-chart) ───────────────

const CHANNEL_CASE = `
  CASE
    WHEN TRIM(primary_channel) IN ('Paid Search', 'Web Paid')      THEN 'Paid Search'
    WHEN TRIM(primary_channel) IN ('Paid Social', 'Social Media')  THEN 'Paid Social'
    WHEN TRIM(primary_channel) IN ('Web Organic', 'SEO / Organic') THEN 'SEO / Organic'
    WHEN TRIM(primary_channel) = 'Web Direct'                      THEN 'Web Direct'
    WHEN TRIM(primary_channel) = 'Review Sites'                    THEN 'Review Sites'
    WHEN TRIM(primary_channel) = 'Trade Show'                      THEN 'Trade Show'
    WHEN TRIM(primary_channel) IN ('Referral', 'Partner')          THEN 'Referral'
    WHEN TRIM(primary_channel) = 'Email'                           THEN 'Email'
    WHEN TRIM(primary_channel) = 'Sales Development'               THEN 'Sales Development'
    WHEN TRIM(primary_channel) = 'Rep Nurture'                     THEN 'Rep Nurture'
    WHEN TRIM(primary_channel) IN ('Other', 'Web Other')           THEN 'Other'
    WHEN primary_channel IS NULL
      OR TRIM(primary_channel) IN ('', 'Unclassified')            THEN 'Unclassified'
    ELSE TRIM(primary_channel)
  END
`;

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);

    const rawView = searchParams.get('view') ?? 'monthly';
    const view: View = (['monthly', 'quarterly', 'yearly'] as const).includes(rawView as View)
      ? (rawView as View)
      : 'monthly';

    const { from, to } = await resolveRange(
      searchParams.get('from'),
      searchParams.get('to'),
      searchParams.get('quickRange') ?? '6m'
    );

    const periodExpr = periodGroupExpr(view);

    const rows = await query<{
      period_key:    string;
      sort_key:      string;
      opportunities: string;
      demoed:        string;
      new_business:  string;
      upsell:        string;
    }>(
      `SELECT
         ${periodExpr}                                                     AS period_key,
         MIN(created_month)                                                AS sort_key,
         COUNT(*)                                                          AS opportunities,
         COUNT(*) FILTER (WHERE demoed = true)                            AS demoed,
         COUNT(*) FILTER (WHERE order_type = 'New')                      AS new_business,
         COUNT(*) FILTER (WHERE order_type = 'Upsell Group')             AS upsell
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
         AND ($1::text IS NULL OR created_month >= $1)
         AND ($2::text IS NULL OR created_month <= $2)
       GROUP BY period_key
       ORDER BY sort_key ASC`,
      [from, to]
    );

    // ── Per-channel breakdown (for stacked sparklines) ────────────────────────
    // Only rows with a known primary_channel; Unclassified/null excluded.
    const channelRows = await query<{
      period_key:    string;
      channel:       string;
      opportunities: string;
      demoed:        string;
      new_business:  string;
      upsell:        string;
    }>(
      `SELECT
         ${periodExpr}  AS period_key,
         ${CHANNEL_CASE} AS channel,
         COUNT(*)                                         AS opportunities,
         COUNT(*) FILTER (WHERE demoed = true)            AS demoed,
         COUNT(*) FILTER (WHERE order_type = 'New')      AS new_business,
         COUNT(*) FILTER (WHERE order_type = 'Upsell Group') AS upsell
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
         AND ($1::text IS NULL OR created_month >= $1)
         AND ($2::text IS NULL OR created_month <= $2)
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      [from, to]
    );

    // Build period_key → ChannelBreakdown[] map
    const channelMap = new Map<string, ChannelBreakdown[]>();
    for (const r of channelRows) {
      if (!channelMap.has(r.period_key)) channelMap.set(r.period_key, []);
      channelMap.get(r.period_key)!.push({
        channel:       r.channel,
        opportunities: Number(r.opportunities),
        demoed:        Number(r.demoed),
        new_business:  Number(r.new_business),
        upsell:        Number(r.upsell),
      });
    }

    const periods = rows.map((r) => periodDisplayLabel(r.period_key, view));

    const mapTrend = (field: 'opportunities' | 'demoed' | 'new_business' | 'upsell'): KpiTrend[] =>
      rows.map((r, i) => ({
        period:     periods[i],
        value:      Number(r[field]),
        by_channel: channelMap.get(r.period_key) ?? [],
      }));

    const showRateTrend: KpiTrend[] = rows.map((r, i) => ({
      period:     periods[i],
      value:      Number(r.opportunities) > 0
        ? Math.round(1000 * Number(r.demoed) / Number(r.opportunities)) / 10
        : 0,
      by_channel: [],
    }));

    // ── Closed Won by close_date (for Demo Conversion + Cohort Win Rate) ─────
    const cdPeriodExpr = closeDatePeriodExpr(view);
    const wonRows = await query<{ period_key: string; closed_won: string }>(
      `SELECT
         ${cdPeriodExpr}                                             AS period_key,
         COUNT(*) FILTER (WHERE stage = 'Closed Won'
           AND COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified')
               NOT IN ('Unclassified'))                              AS closed_won
       FROM salesforce_opportunities
       WHERE close_date IS NOT NULL
         AND ($1::text IS NULL OR TO_CHAR(close_date, 'YYYY-MM') >= $1)
         AND ($2::text IS NULL OR TO_CHAR(close_date, 'YYYY-MM') <= $2)
       GROUP BY 1
       ORDER BY 1`,
      [from, to]
    );

    // Map period_key → closed_won (period_keys produced by closeDatePeriodExpr
    // align with those from periodGroupExpr when the same view is used)
    const wonMap = new Map<string, number>(
      wonRows.map((r) => [r.period_key, Number(r.closed_won)])
    );
    const totalWon      = wonRows.reduce((s, r) => s + Number(r.closed_won), 0);
    const totalDemoed   = rows.reduce((s, r) => s + Number(r.demoed),  0);
    const totalCreated  = rows.reduce((s, r) => s + Number(r.opportunities), 0);

    // Per-period rate trends — numerator from close_date map, denominator from cohort rows
    const demoConvTrend: KpiTrend[] = rows.map((r, i) => {
      const won    = wonMap.get(r.period_key) ?? 0;
      const demoed = Number(r.demoed);
      return { period: periods[i], value: demoed > 0 ? Math.round(1000 * won / demoed) / 10 : 0, by_channel: [] };
    });

    const winRateTrend: KpiTrend[] = rows.map((r, i) => {
      const won  = wonMap.get(r.period_key) ?? 0;
      const opps = Number(r.opportunities);
      return { period: periods[i], value: opps > 0 ? Math.round(1000 * won / opps) / 10 : 0, by_channel: [] };
    });

    const last = rows.length - 1;
    const lastRow = last >= 0 ? rows[last] : null;

    return NextResponse.json({
      periods,
      kpis: {
        opportunities: {
          current: lastRow ? Number(lastRow.opportunities) : 0,
          trend:   mapTrend('opportunities'),
        },
        demoed: {
          current: lastRow ? Number(lastRow.demoed) : 0,
          trend:   mapTrend('demoed'),
        },
        new_business: {
          current: lastRow ? Number(lastRow.new_business) : 0,
          trend:   mapTrend('new_business'),
        },
        upsell: {
          current: lastRow ? Number(lastRow.upsell) : 0,
          trend:   mapTrend('upsell'),
        },
        show_rate: {
          current: lastRow && Number(lastRow.opportunities) > 0
            ? Math.round(1000 * Number(lastRow.demoed) / Number(lastRow.opportunities)) / 10
            : 0,
          trend: showRateTrend,
        },
        demo_conversion: {
          current: totalDemoed > 0 ? Math.round(1000 * totalWon / totalDemoed) / 10 : 0,
          trend:   demoConvTrend,
        },
        cohort_win_rate: {
          current: totalCreated > 0 ? Math.round(1000 * totalWon / totalCreated) / 10 : 0,
          trend:   winRateTrend,
        },
      },
    } satisfies KpiResponse);
  } catch (err) {
    console.error('[api/dashboard/kpis]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
