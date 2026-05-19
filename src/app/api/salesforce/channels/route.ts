import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { formatMonthShort } from '@/lib/format';

// ─── Channel display mapping ──────────────────────────────────────────────────

const CHANNEL_LABEL_MAP: Record<string, string> = {
  'Web Paid': 'Paid Search',
  'Web Organic': 'SEO / Organic',
  'Social Media': 'Paid Social',
  'Referral': 'Partner / Referral',
  'Partner': 'Partner / Referral',
  'Web Other': 'Other',
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
  const trimmed = raw.trim();
  return CHANNEL_LABEL_MAP[trimmed] ?? trimmed;
}

function periodLabel(key: string, view: string): string {
  // key is either "YYYY-MM" (monthly) or "YYYY-Q#" (quarterly)
  if (view === 'quarterly') return key; // already formatted below
  return formatMonthShort(key);
}

// ─── route ───────────────────────────────────────────────────────────────────

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

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') === 'quarterly' ? 'quarterly' : 'monthly';

    // Build the period expression
    const periodExpr =
      view === 'quarterly'
        ? `TO_CHAR(DATE_TRUNC('quarter', created_date), 'YYYY') || '-Q' ||
           EXTRACT(QUARTER FROM created_date)::int`
        : `created_month`;

    const rows = await query<{
      period_key: string;
      raw_channel: string;
      created: string;
      won: string;
      lost: string;
      open: string;
    }>(
      `SELECT
         ${periodExpr}                                                       AS period_key,
         COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified')        AS raw_channel,
         COUNT(*)                                                            AS created,
         COUNT(*) FILTER (WHERE stage = 'Closed Won')                       AS won,
         COUNT(*) FILTER (WHERE stage = 'Closed Lost')                      AS lost,
         COUNT(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost'))   AS open
       FROM salesforce_opportunities
       WHERE created_date IS NOT NULL
         AND COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified')
             NOT IN ('Unclassified')
       GROUP BY 1, 2
       ORDER BY 1 ASC, 2 ASC`
    );

    // Collect all distinct periods (sorted)
    const periodSet = new Set<string>();
    for (const r of rows) periodSet.add(r.period_key);
    const sortedPeriodKeys = [...periodSet].sort();

    // Build period display labels
    const periodLabels = sortedPeriodKeys.map((k) => {
      if (view === 'quarterly') {
        // "2025-Q1" → "Q1 2025"
        const [yr, q] = k.split('-');
        return `${q} ${yr}`;
      }
      return formatMonthShort(k);
    });

    // Group raw rows by display channel label
    type CellMap = Map<string, { created: number; won: number; lost: number; open: number }>;
    const channelMap = new Map<string, CellMap>();

    for (const r of rows) {
      const label = channelLabel(r.raw_channel);
      if (!channelMap.has(label)) channelMap.set(label, new Map());
      const cellMap = channelMap.get(label)!;

      // Merge into existing cell (multiple raw channels may map to same display label)
      const prev = cellMap.get(r.period_key) ?? { created: 0, won: 0, lost: 0, open: 0 };
      cellMap.set(r.period_key, {
        created: prev.created + Number(r.created),
        won:     prev.won     + Number(r.won),
        lost:    prev.lost    + Number(r.lost),
        open:    prev.open    + Number(r.open),
      });
    }

    // Build channel cohorts in fixed order, then any remaining channels alphabetically
    const orderedLabels = [
      ...CHANNEL_ORDER.filter((c) => channelMap.has(c)),
      ...[...channelMap.keys()]
        .filter((c) => !CHANNEL_ORDER.includes(c))
        .sort(),
    ];

    const channels: ChannelCohort[] = orderedLabels.map((label) => {
      const cellMap = channelMap.get(label)!;
      const values: CohortCell[] = sortedPeriodKeys.map((pk, i) => {
        const cell = cellMap.get(pk) ?? { created: 0, won: 0, lost: 0, open: 0 };
        return { period: periodLabels[i], ...cell };
      });
      return {
        channel: label,
        color: CHANNEL_COLORS[label] ?? '#94a3b8',
        values,
      };
    });

    // Build totals row
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
