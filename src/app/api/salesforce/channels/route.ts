import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { formatMonthShort } from '@/lib/format';

// ─── Channel display mapping ──────────────────────────────────────────────────

const CHANNEL_LABEL_MAP: Record<string, string> = {
  'Web Paid':     'Paid Search',
  'Web Organic':  'SEO / Organic',
  'Social Media': 'Paid Social',
  'Referral':     'Partner / Referral',
  'Partner':      'Partner / Referral',
  'Web Other':    'Other',
};

const CHANNEL_ORDER: string[] = [
  'Paid Search',
  'Paid Social',
  'SEO / Organic',
  'Web Direct',
  'Review Sites',
  'Trade Show',
  'Partner / Referral',
  'Sales Development',
  'Rep Nurture',
  'Email',
  'Other',
];

const CHANNEL_COLORS: Record<string, string> = {
  'Paid Search':        '#06b6d4',
  'Paid Social':        '#f97316',
  'SEO / Organic':      '#22c55e',
  'Web Direct':         '#3b82f6',
  'Review Sites':       '#a855f7',
  'Trade Show':         '#ef4444',
  'Partner / Referral': '#eab308',
  'Sales Development':  '#38bdf8',
  'Rep Nurture':        '#0d9488',
  'Email':              '#f59e0b',
  'Other':              '#6b7280',
};

function channelLabel(raw: string): string {
  return CHANNEL_LABEL_MAP[raw.trim()] ?? raw.trim();
}

// ─── Route types ──────────────────────────────────────────────────────────────

export interface CohortCell {
  period: string;
  created: number;
  won: number;
  lost: number;
  open: number;
}

export interface ChannelCohort {
  channel: string;
  color: string;
  values: CohortCell[];
}

export interface CohortResponse {
  periods: string[];
  channels: ChannelCohort[];
  totals: CohortCell[];
}

type View = 'monthly' | 'quarterly' | 'yearly';

// ─── Period helpers ───────────────────────────────────────────────────────────

/** SQL expression that produces the period key from created_month (YYYY-MM) */
function periodSqlExpr(view: View): string {
  if (view === 'quarterly') {
    // e.g. "2025-Q1"
    return `LEFT(created_month, 4) || '-Q' ||
            CEIL(RIGHT(created_month, 2)::int / 3.0)::int`;
  }
  if (view === 'yearly') {
    return `LEFT(created_month, 4)`;
  }
  // monthly: key already is created_month (YYYY-MM)
  return `created_month`;
}

/** Convert a sort key to a display label */
function periodDisplayLabel(key: string, view: View): string {
  if (view === 'quarterly') {
    // "2025-Q1" → "Q1 2025"
    const [yr, q] = key.split('-');
    return `${q} ${yr}`;
  }
  if (view === 'yearly') {
    return key; // "2025"
  }
  return formatMonthShort(key); // "Jan 25"
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);

    const rawView = searchParams.get('view') ?? 'monthly';
    const view: View = ['monthly', 'quarterly', 'yearly'].includes(rawView)
      ? (rawView as View)
      : 'monthly';

    const year     = searchParams.get('year')      ?? 'all';
    const monthKey = searchParams.get('month_key') ?? 'all';

    // ── WHERE conditions ──────────────────────────────────────────────────────
    const conditions: string[] = [
      `created_month IS NOT NULL AND created_month != ''`,
      `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`,
    ];
    const params: string[] = [];

    if (monthKey !== 'all') {
      params.push(monthKey);
      conditions.push(`created_month = $${params.length}`);
    } else if (year !== 'all') {
      params.push(year);
      conditions.push(`LEFT(created_month, 4) = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const periodExpr  = periodSqlExpr(view);

    // ── Query ─────────────────────────────────────────────────────────────────
    const rows = await query<{
      period_key:  string;
      raw_channel: string;
      created:     string;
      won:         string;
      lost:        string;
      open:        string;
    }>(
      `SELECT
         ${periodExpr}                                                        AS period_key,
         COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified')         AS raw_channel,
         COUNT(*)                                                             AS created,
         COUNT(*) FILTER (WHERE stage = 'Closed Won')                        AS won,
         COUNT(*) FILTER (WHERE stage = 'Closed Lost')                       AS lost,
         COUNT(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost'))    AS open
       FROM salesforce_opportunities
       ${whereClause}
       GROUP BY 1, 2
       ORDER BY 1 ASC, 2 ASC`,
      params
    );

    // ── Build period list (sorted) ────────────────────────────────────────────
    const periodSet = new Set<string>();
    for (const r of rows) periodSet.add(r.period_key);
    const sortedPeriodKeys = [...periodSet].sort();

    const periodLabels = sortedPeriodKeys.map((k) => periodDisplayLabel(k, view));

    // ── Aggregate by display channel + period ─────────────────────────────────
    type CellMap = Map<string, { created: number; won: number; lost: number; open: number }>;
    const channelMap = new Map<string, CellMap>();

    for (const r of rows) {
      const label = channelLabel(r.raw_channel);
      if (!channelMap.has(label)) channelMap.set(label, new Map());
      const cellMap = channelMap.get(label)!;

      const prev = cellMap.get(r.period_key) ?? { created: 0, won: 0, lost: 0, open: 0 };
      cellMap.set(r.period_key, {
        created: prev.created + Number(r.created),
        won:     prev.won     + Number(r.won),
        lost:    prev.lost    + Number(r.lost),
        open:    prev.open    + Number(r.open),
      });
    }

    // ── Build channel cohorts in fixed order ──────────────────────────────────
    const orderedLabels = [
      ...CHANNEL_ORDER.filter((c) => channelMap.has(c)),
      ...[...channelMap.keys()].filter((c) => !CHANNEL_ORDER.includes(c)).sort(),
    ];

    const channels: ChannelCohort[] = orderedLabels.map((label) => {
      const cellMap = channelMap.get(label)!;
      const values: CohortCell[] = sortedPeriodKeys.map((pk, i) => {
        const cell = cellMap.get(pk) ?? { created: 0, won: 0, lost: 0, open: 0 };
        return { period: periodLabels[i], ...cell };
      });
      return { channel: label, color: CHANNEL_COLORS[label] ?? '#94a3b8', values };
    });

    // ── Totals row ────────────────────────────────────────────────────────────
    const totals: CohortCell[] = sortedPeriodKeys.map((pk, i) => {
      let created = 0, won = 0, lost = 0, open = 0;
      for (const cellMap of channelMap.values()) {
        const cell = cellMap.get(pk);
        if (cell) { created += cell.created; won += cell.won; lost += cell.lost; open += cell.open; }
      }
      return { period: periodLabels[i], created, won, lost, open };
    });

    return NextResponse.json({ periods: periodLabels, channels, totals } satisfies CohortResponse);
  } catch (err) {
    console.error('[api/salesforce/channels]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
