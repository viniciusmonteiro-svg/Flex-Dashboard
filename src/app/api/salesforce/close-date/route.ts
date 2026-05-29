import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

// ─── Channel mapping (mirrors channels/route.ts) ──────────────────────────────

const CHANNEL_LABEL_MAP: Record<string, string> = {
  'Web Paid':     'Paid Search',
  'Web Organic':  'SEO / Organic',
  'Social Media': 'Paid Social',
  'Referral':     'Partner / Referral',
  'Partner':      'Partner / Referral',
  'Web Other':    'Other',
};

const CHANNEL_ORDER = [
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

function channelLabel(raw: string): string {
  const t = raw.trim();
  return CHANNEL_LABEL_MAP[t] ?? (CHANNEL_ORDER.includes(t) ? t : 'Other');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloseDateCell {
  won_count: number;
  arr:       number;        // dollars (monthly_mrr / 100)
  asp:       number | null; // dollars; null when won_count === 0
}

export interface CloseDateRow {
  channel:    string;
  values:     CloseDateCell[];  // one per period
  total_count: number;
  total_arr:   number;
  total_asp:   number | null;
}

export interface CloseDateResponse {
  periods:         string[];         // display labels
  rows:            CloseDateRow[];
  portfolio_count: number[];
  portfolio_arr:   number[];
  portfolio_asp:   (number | null)[];
}

type View = 'monthly' | 'quarterly' | 'yearly';

// ─── SQL helpers ──────────────────────────────────────────────────────────────

function closeDateExprs(view: View): { sortExpr: string; labelExpr: string } {
  if (view === 'monthly') {
    return {
      sortExpr:  `TO_CHAR(close_date, 'YYYY-MM')`,
      labelExpr: `TO_CHAR(close_date, 'Mon ''YY')`,
    };
  }
  if (view === 'quarterly') {
    return {
      sortExpr:  `TO_CHAR(close_date, 'YYYY') || '-Q' || CEIL(EXTRACT(MONTH FROM close_date) / 3.0)::int::text`,
      labelExpr: `'Q' || CEIL(EXTRACT(MONTH FROM close_date) / 3.0)::int::text || ' ' || TO_CHAR(close_date, 'YYYY')`,
    };
  }
  // yearly
  return {
    sortExpr:  `TO_CHAR(close_date, 'YYYY')`,
    labelExpr: `TO_CHAR(close_date, 'YYYY')`,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const rawView = searchParams.get('view') ?? 'quarterly';
    const view: View = ['monthly', 'quarterly', 'yearly'].includes(rawView)
      ? (rawView as View)
      : 'quarterly';

    // from / to are YYYY-MM strings; applied as TO_CHAR(close_date,'YYYY-MM') comparisons
    const from = searchParams.get('from') || null;
    const to   = searchParams.get('to')   || null;

    const { sortExpr, labelExpr } = closeDateExprs(view);

    const params: unknown[] = [];
    const conditions: string[] = [
      `stage = 'Closed Won'`,
      `close_date IS NOT NULL`,
      `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`,
    ];

    if (from) {
      params.push(from);
      conditions.push(`TO_CHAR(close_date, 'YYYY-MM') >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`TO_CHAR(close_date, 'YYYY-MM') <= $${params.length}`);
    }

    const rows = await query<{
      sort_key:    string;
      period:      string;
      raw_channel: string;
      won_count:   string;
      arr:         string;
    }>(
      `SELECT
         ${sortExpr}             AS sort_key,
         ${labelExpr}            AS period,
         TRIM(primary_channel)   AS raw_channel,
         COUNT(*)                AS won_count,
         SUM(monthly_mrr) * 12 / 100.0 AS arr
       FROM salesforce_opportunities
       WHERE ${conditions.join(' AND ')}
       GROUP BY sort_key, period, raw_channel
       ORDER BY sort_key`,
      params,
    );

    // ── Build sorted period list ───────────────────────────────────────────────
    const periodMap = new Map<string, string>(); // sort_key → display label
    for (const r of rows) periodMap.set(r.sort_key, r.period);
    const sortedKeys = [...periodMap.keys()].sort();
    const periods    = sortedKeys.map((k) => periodMap.get(k)!);

    // ── Aggregate by display channel + sort_key ────────────────────────────────
    type Cell = { won_count: number; arr: number };
    const channelMap = new Map<string, Map<string, Cell>>();

    for (const r of rows) {
      const label = channelLabel(r.raw_channel);
      if (!channelMap.has(label)) channelMap.set(label, new Map());
      const cm   = channelMap.get(label)!;
      const prev = cm.get(r.sort_key) ?? { won_count: 0, arr: 0 };
      cm.set(r.sort_key, {
        won_count: prev.won_count + Number(r.won_count),
        arr:       prev.arr       + Number(r.arr),
      });
    }

    // ── Build output rows in fixed channel order ───────────────────────────────
    const orderedLabels = [
      ...CHANNEL_ORDER.filter((c) => channelMap.has(c)),
      ...[...channelMap.keys()].filter((c) => !CHANNEL_ORDER.includes(c)).sort(),
    ];

    const outputRows: CloseDateRow[] = orderedLabels.map((label) => {
      const cm = channelMap.get(label)!;
      const values: CloseDateCell[] = sortedKeys.map((k) => {
        const cell = cm.get(k) ?? { won_count: 0, arr: 0 };
        return {
          won_count: cell.won_count,
          arr:       cell.arr,
          asp:       cell.won_count > 0 ? cell.arr / cell.won_count : null,
        };
      });
      const total_count = values.reduce((s, v) => s + v.won_count, 0);
      const total_arr   = values.reduce((s, v) => s + v.arr,       0);
      return {
        channel:    label,
        values,
        total_count,
        total_arr,
        total_asp: total_count > 0 ? total_arr / total_count : null,
      };
    });

    // ── Portfolio totals per period ────────────────────────────────────────────
    const portfolio_count = sortedKeys.map((k) =>
      orderedLabels.reduce((s, l) => s + (channelMap.get(l)!.get(k)?.won_count ?? 0), 0),
    );
    const portfolio_arr = sortedKeys.map((k) =>
      orderedLabels.reduce((s, l) => s + (channelMap.get(l)!.get(k)?.arr ?? 0), 0),
    );
    const portfolio_asp = sortedKeys.map((_, i) =>
      portfolio_count[i] > 0 ? portfolio_arr[i] / portfolio_count[i] : null,
    );

    return NextResponse.json({
      periods,
      rows:            outputRows,
      portfolio_count,
      portfolio_arr,
      portfolio_asp,
    } satisfies CloseDateResponse);
  } catch (err) {
    console.error('[api/salesforce/close-date]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
