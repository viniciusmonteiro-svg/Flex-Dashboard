'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPercent, formatMonthShort } from '@/lib/format';
import type { CohortResponse, ChannelCohort, CohortCell } from '@/app/api/salesforce/channels/route';
import type { CampaignRow } from '@/app/api/salesforce/campaigns/route';

// ─── constants ────────────────────────────────────────────────────────────────

const DARK_BG      = '#0f172a';
const CARD_BG      = '#1e293b';
const CARD_BORDER  = '#334155';
const HEADER_BG    = '#0f766e';  // teal-700
const TOTAL_BG     = '#0c1524';
const TEXT_PRIMARY = '#f1f5f9';
const TEXT_MUTED   = '#64748b';
const TEAL         = '#14b8a6';

type Metric = 'created' | 'won' | 'winrate';
type View   = 'monthly' | 'quarterly';

// ─── helpers ─────────────────────────────────────────────────────────────────

function cellValue(cell: CohortCell, metric: Metric): number {
  if (metric === 'created')  return cell.created;
  if (metric === 'won')      return cell.won;
  // win rate
  return cell.created > 0 ? (cell.won / cell.created) * 100 : 0;
}

function fmtCell(val: number, metric: Metric): string {
  if (val === 0) return '';
  if (metric === 'winrate') return formatPercent(val, 0);
  return String(val);
}

function rowTotal(ch: ChannelCohort, metric: Metric): number {
  return ch.values.reduce((s, c) => s + cellValue(c, metric), 0);
}

function totalRow(totals: CohortCell[], metric: Metric): number {
  return totals.reduce((s, c) => s + cellValue(c, metric), 0);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full overflow-hidden border" style={{ borderColor: CARD_BORDER }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="px-4 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: value === o.value ? TEAL : 'transparent',
            color: value === o.value ? '#fff' : TEXT_MUTED,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-bold text-white"
      style={{ background: HEADER_BG }}
    >
      <span>{label}</span>
      <span className="text-lg leading-none">{open ? '▾' : '▸'}</span>
    </button>
  );
}

interface PivotTableProps {
  periods: string[];
  channels: ChannelCohort[];
  totals: CohortCell[];
  metric: Metric;
  loading: boolean;
}

function PivotTable({ periods, channels, totals, metric, loading }: PivotTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto"
      style={{ background: CARD_BG }}
    >
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* sticky channel column header */}
            <th
              className="sticky left-0 z-10 px-4 py-2.5 text-left font-semibold"
              style={{
                background: CARD_BG,
                color: TEXT_MUTED,
                minWidth: 180,
                borderBottom: `1px solid ${CARD_BORDER}`,
              }}
            >
              Channel
            </th>
            {periods.map((p) => (
              <th
                key={p}
                className="px-3 py-2.5 text-right font-medium whitespace-nowrap"
                style={{ color: TEXT_MUTED, borderBottom: `1px solid ${CARD_BORDER}`, minWidth: 64 }}
              >
                {p}
              </th>
            ))}
            <th
              className="px-4 py-2.5 text-right font-bold whitespace-nowrap"
              style={{ color: TEXT_MUTED, borderBottom: `1px solid ${CARD_BORDER}`, minWidth: 64 }}
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td className="sticky left-0 px-4 py-2.5" style={{ background: CARD_BG }}>
                  <div className="h-4 w-32 rounded animate-pulse" style={{ background: CARD_BORDER }} />
                </td>
                {Array.from({ length: (periods.length || 4) + 1 }).map((_, j) => (
                  <td key={j} className="px-3 py-2.5">
                    <div className="h-4 w-8 ml-auto rounded animate-pulse" style={{ background: CARD_BORDER }} />
                  </td>
                ))}
              </tr>
            ))
          ) : channels.length === 0 ? (
            <tr>
              <td
                colSpan={periods.length + 2}
                className="px-4 py-8 text-center"
                style={{ color: TEXT_MUTED }}
              >
                No data
              </td>
            </tr>
          ) : (
            <>
              {channels.map((ch) => {
                const rt = rowTotal(ch, metric);
                return (
                  <tr
                    key={ch.channel}
                    className="group"
                    style={{ borderBottom: `1px solid ${CARD_BORDER}` }}
                  >
                    {/* sticky channel cell */}
                    <td
                      className="sticky left-0 px-4 py-2 font-medium"
                      style={{ background: CARD_BG, color: TEXT_PRIMARY, minWidth: 180 }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block rounded-full flex-shrink-0"
                          style={{ width: 8, height: 8, background: ch.color }}
                        />
                        {ch.channel}
                      </span>
                    </td>
                    {ch.values.map((cell, i) => {
                      const v = cellValue(cell, metric);
                      return (
                        <td
                          key={i}
                          className="px-3 py-2 text-right tabular-nums"
                          style={{ color: v > 0 ? TEXT_PRIMARY : TEXT_MUTED }}
                        >
                          {v > 0 ? fmtCell(v, metric) : '—'}
                        </td>
                      );
                    })}
                    <td
                      className="px-4 py-2 text-right tabular-nums font-semibold"
                      style={{ color: rt > 0 ? TEXT_PRIMARY : TEXT_MUTED }}
                    >
                      {rt > 0 ? fmtCell(rt, metric) : '—'}
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ background: TOTAL_BG }}>
                <td
                  className="sticky left-0 px-4 py-2.5 font-bold"
                  style={{ background: TOTAL_BG, color: TEXT_PRIMARY }}
                >
                  Total
                </td>
                {totals.map((cell, i) => {
                  const v = cellValue(cell, metric);
                  return (
                    <td
                      key={i}
                      className="px-3 py-2.5 text-right tabular-nums font-bold"
                      style={{ color: v > 0 ? TEXT_PRIMARY : TEXT_MUTED }}
                    >
                      {v > 0 ? fmtCell(v, metric) : '—'}
                    </td>
                  );
                })}
                <td
                  className="px-4 py-2.5 text-right tabular-nums font-bold"
                  style={{ color: TEXT_PRIMARY }}
                >
                  {fmtCell(totalRow(totals, metric), metric) || '—'}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function SalesforceClient() {
  const [view, setView]     = useState<View>('monthly');
  const [metric, setMetric] = useState<Metric>('created');

  const [cohort, setCohort]       = useState<CohortResponse | null>(null);
  const [loadingCohort, setLoadingCohort] = useState(true);

  // Campaign section
  const [months, setMonths]               = useState<string[]>([]);
  const [campaignMonth, setCampaignMonth] = useState('all');
  const [campaignChannel, setCampaignChannel] = useState('all');
  const [campaignData, setCampaignData]   = useState<CampaignRow[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  // Collapsible section state
  const [wonOpen,     setWonOpen]     = useState(true);
  const [winrateOpen, setWinrateOpen] = useState(false);

  // ── fetch cohort data ──────────────────────────────────────────────────────
  const fetchCohort = useCallback(async (v: View) => {
    setLoadingCohort(true);
    try {
      const res = await fetch(`/api/salesforce/channels?view=${v}`);
      const d: CohortResponse = await res.json();
      setCohort(d);
    } finally {
      setLoadingCohort(false);
    }
  }, []);

  useEffect(() => { fetchCohort(view); }, [view, fetchCohort]);

  // ── fetch months + campaigns ───────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/salesforce/months')
      .then((r) => r.json())
      .then((d) => setMonths(d.months ?? []));
  }, []);

  const fetchCampaigns = useCallback(async (month: string, channel: string) => {
    setLoadingCampaigns(true);
    try {
      const res = await fetch(
        `/api/salesforce/campaigns?month=${month}&channel=${encodeURIComponent(channel)}`
      );
      const d = await res.json();
      setCampaignData(d.rows ?? []);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns(campaignMonth, campaignChannel);
  }, [campaignMonth, campaignChannel, fetchCampaigns]);

  // ── campaign pivot ─────────────────────────────────────────────────────────
  const { pivotMonths, pivotSources, pivotMap } = useMemo(() => {
    const monthSet  = new Set<string>();
    const sourceSet = new Set<string>();
    const map       = new Map<string, Map<string, number>>();

    for (const row of campaignData) {
      monthSet.add(row.created_month);
      sourceSet.add(row.campaign_source);
      if (!map.has(row.campaign_source)) map.set(row.campaign_source, new Map());
      map.get(row.campaign_source)!.set(row.created_month, row.closed_won);
    }

    const pMonths  = [...monthSet].sort();
    const rowTotal = (src: string) =>
      [...(map.get(src)?.values() ?? [])].reduce((s, v) => s + v, 0);

    const pSources = [...sourceSet].sort((a, b) => {
      if (a === '(no campaign)') return 1;
      if (b === '(no campaign)') return -1;
      return rowTotal(b) - rowTotal(a);
    });

    return { pivotMonths: pMonths, pivotSources: pSources, pivotMap: map };
  }, [campaignData]);

  const channelOptions = useMemo(
    () => cohort?.channels.map((c) => c.channel) ?? [],
    [cohort]
  );

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-6 py-8 space-y-8" style={{ background: DARK_BG, color: TEXT_PRIMARY }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: TEXT_PRIMARY }}>
            Pipeline Cohort
          </h1>
          <p className="mt-1 text-sm max-w-lg" style={{ color: TEXT_MUTED }}>
            Each column = opportunities created in that period;
            Won / Lost / Open figures show current outcome to-date.{' '}
            <span style={{ color: TEAL }}>Recent cohorts are still maturing.</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup<Metric>
            options={[
              { label: 'Opps Created', value: 'created' },
              { label: 'Closed Won',   value: 'won'     },
              { label: 'Win Rate',     value: 'winrate' },
            ]}
            value={metric}
            onChange={setMetric}
          />
          <ToggleGroup<View>
            options={[
              { label: 'Monthly',   value: 'monthly'   },
              { label: 'Quarterly', value: 'quarterly' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      {/* ── Main cohort table ────────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${CARD_BORDER}` }}>
        {/* Section header */}
        <div
          className="px-4 py-2.5 text-sm font-bold"
          style={{ background: HEADER_BG, color: '#fff' }}
        >
          {metric === 'created' && 'Opportunities Created (count)'}
          {metric === 'won'     && 'Closed Won (count)'}
          {metric === 'winrate' && 'Win Rate (%)'}
        </div>

        <PivotTable
          periods={cohort?.periods ?? []}
          channels={cohort?.channels ?? []}
          totals={cohort?.totals ?? []}
          metric={metric}
          loading={loadingCohort}
        />
      </div>

      {/* ── Collapsible: Closed Won ────────────────────────────────────── */}
      {metric !== 'won' && (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <SectionHeader
            label="Closed Won (count)"
            open={wonOpen}
            onToggle={() => setWonOpen((v) => !v)}
          />
          {wonOpen && (
            <PivotTable
              periods={cohort?.periods ?? []}
              channels={cohort?.channels ?? []}
              totals={cohort?.totals ?? []}
              metric="won"
              loading={loadingCohort}
            />
          )}
        </div>
      )}

      {/* ── Collapsible: Win Rate ──────────────────────────────────────── */}
      {metric !== 'winrate' && (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <SectionHeader
            label="Win Rate (%)"
            open={winrateOpen}
            onToggle={() => setWinrateOpen((v) => !v)}
          />
          {winrateOpen && (
            <PivotTable
              periods={cohort?.periods ?? []}
              channels={cohort?.channels ?? []}
              totals={cohort?.totals ?? []}
              metric="winrate"
              loading={loadingCohort}
            />
          )}
        </div>
      )}

      {/* ── Campaign Source Breakdown ─────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold mr-2" style={{ color: TEXT_PRIMARY }}>
            Opportunities by Campaign Source
          </h2>

          {/* Month select */}
          <select
            value={campaignMonth}
            onChange={(e) => setCampaignMonth(e.target.value)}
            className="rounded-md px-3 py-1.5 text-sm focus:outline-none"
            style={{
              background: CARD_BG,
              border: `1px solid ${CARD_BORDER}`,
              color: TEXT_PRIMARY,
            }}
          >
            <option value="all">All Months</option>
            {months.map((m) => (
              <option key={m} value={m}>{formatMonthShort(m)}</option>
            ))}
          </select>

          {/* Channel select */}
          <select
            value={campaignChannel}
            onChange={(e) => setCampaignChannel(e.target.value)}
            className="rounded-md px-3 py-1.5 text-sm focus:outline-none"
            style={{
              background: CARD_BG,
              border: `1px solid ${CARD_BORDER}`,
              color: TEXT_PRIMARY,
            }}
          >
            <option value="all">All Channels</option>
            {channelOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <div className="overflow-x-auto" style={{ background: CARD_BG }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-10 px-4 py-2.5 text-left font-semibold"
                    style={{
                      background: CARD_BG,
                      color: TEXT_MUTED,
                      minWidth: 200,
                      borderBottom: `1px solid ${CARD_BORDER}`,
                    }}
                  >
                    Campaign Source
                  </th>
                  {pivotMonths.map((m) => (
                    <th
                      key={m}
                      className="px-3 py-2.5 text-right whitespace-nowrap font-medium"
                      style={{ color: TEXT_MUTED, borderBottom: `1px solid ${CARD_BORDER}`, minWidth: 56 }}
                    >
                      {formatMonthShort(m)}
                    </th>
                  ))}
                  <th
                    className="px-4 py-2.5 text-right font-bold"
                    style={{ color: TEXT_MUTED, borderBottom: `1px solid ${CARD_BORDER}`, minWidth: 56 }}
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingCampaigns ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="sticky left-0 px-4 py-2.5" style={{ background: CARD_BG }}>
                        <div className="h-4 w-36 rounded animate-pulse" style={{ background: CARD_BORDER }} />
                      </td>
                      {Array.from({ length: (pivotMonths.length || 4) + 1 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5">
                          <div className="h-4 w-8 ml-auto rounded animate-pulse" style={{ background: CARD_BORDER }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : pivotSources.length === 0 ? (
                  <tr>
                    <td
                      colSpan={pivotMonths.length + 2}
                      className="px-4 py-8 text-center"
                      style={{ color: TEXT_MUTED }}
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  <>
                    {pivotSources.map((src) => {
                      const rowMap   = pivotMap.get(src) ?? new Map();
                      const rowTotal = [...rowMap.values()].reduce((s, v) => s + v, 0);
                      const isNo     = src === '(no campaign)';
                      return (
                        <tr key={src} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                          <td
                            className="sticky left-0 px-4 py-2 font-medium truncate max-w-[220px]"
                            style={{ background: CARD_BG, color: isNo ? TEXT_MUTED : TEXT_PRIMARY }}
                          >
                            {src}
                          </td>
                          {pivotMonths.map((m) => {
                            const v = rowMap.get(m) ?? 0;
                            return (
                              <td
                                key={m}
                                className="px-3 py-2 text-right tabular-nums"
                                style={{ color: v > 0 ? TEXT_PRIMARY : TEXT_MUTED }}
                              >
                                {v > 0 ? v : '—'}
                              </td>
                            );
                          })}
                          <td
                            className="px-4 py-2 text-right tabular-nums font-semibold"
                            style={{ color: rowTotal > 0 ? TEXT_PRIMARY : TEXT_MUTED }}
                          >
                            {rowTotal > 0 ? rowTotal : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr style={{ background: TOTAL_BG }}>
                      <td
                        className="sticky left-0 px-4 py-2.5 font-bold"
                        style={{ background: TOTAL_BG, color: TEXT_PRIMARY }}
                      >
                        Total
                      </td>
                      {pivotMonths.map((m) => {
                        const colTotal = pivotSources.reduce(
                          (s, src) => s + (pivotMap.get(src)?.get(m) ?? 0),
                          0
                        );
                        return (
                          <td
                            key={m}
                            className="px-3 py-2.5 text-right tabular-nums font-bold"
                            style={{ color: colTotal > 0 ? TEXT_PRIMARY : TEXT_MUTED }}
                          >
                            {colTotal > 0 ? colTotal : '—'}
                          </td>
                        );
                      })}
                      <td
                        className="px-4 py-2.5 text-right tabular-nums font-bold"
                        style={{ color: TEXT_PRIMARY }}
                      >
                        {campaignData.reduce((s, r) => s + r.closed_won, 0) || '—'}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
