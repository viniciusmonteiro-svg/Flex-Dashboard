'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatPercent, formatMonthShort } from '@/lib/format';
import type { CohortResponse, ChannelCohort, CohortCell } from '@/app/api/salesforce/channels/route';
import type { CampaignRow } from '@/app/api/salesforce/campaigns/route';
import type { CloseDateResponse, CloseDateRow, CloseDateCell } from '@/app/api/salesforce/close-date/route';

// ─── constants ────────────────────────────────────────────────────────────────

const KNOWN_CHANNELS = [
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

type Metric    = 'created' | 'won' | 'demoed' | 'showrate' | 'open';
type View      = 'monthly' | 'quarterly' | 'yearly';
type Preset    = '6m' | '12m' | '24m' | 'qoq' | 'all';
type Subtab    = 'cohort' | 'closedate';

// ─── helpers ─────────────────────────────────────────────────────────────────

function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function snapFrom(mk: string, v: View): string {
  if (v === 'yearly')    return `${mk.slice(0, 4)}-01`;
  if (v === 'quarterly') {
    const m = Number(mk.slice(5, 7));
    return `${mk.slice(0, 4)}-${String((Math.ceil(m / 3) - 1) * 3 + 1).padStart(2, '0')}`;
  }
  return mk;
}

function snapTo(mk: string, v: View): string {
  if (v === 'yearly')    return `${mk.slice(0, 4)}-12`;
  if (v === 'quarterly') {
    const m = Number(mk.slice(5, 7));
    return `${mk.slice(0, 4)}-${String(Math.ceil(m / 3) * 3).padStart(2, '0')}`;
  }
  return mk;
}

function monthToQuarterKey(mk: string): string {
  return `${mk.slice(0, 4)}-Q${Math.ceil(Number(mk.slice(5, 7)) / 3)}`;
}

function quarterKeyToFrom(qk: string): string {
  const q = Number(qk.slice(-1));
  return `${qk.slice(0, 4)}-${String((q - 1) * 3 + 1).padStart(2, '0')}`;
}

function quarterKeyToTo(qk: string): string {
  const q = Number(qk.slice(-1));
  return `${qk.slice(0, 4)}-${String(q * 3).padStart(2, '0')}`;
}

function quarterKeyToLabel(qk: string): string {
  return `Q${qk.slice(-1)} '${qk.slice(2, 4)}`;
}

function monthsToQuarterKeys(months: string[]): string[] {
  return [...new Set(months.map(monthToQuarterKey))].sort().reverse();
}

function monthsToYears(months: string[]): string[] {
  return [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();
}

function cellValue(cell: CohortCell, metric: Metric): number {
  if (metric === 'created')  return cell.created;
  if (metric === 'won')      return cell.won;
  if (metric === 'demoed')   return cell.demoed;
  if (metric === 'open')     return cell.open;
  if (metric === 'showrate') return cell.created > 0 ? (cell.demoed / cell.created) * 100 : 0;
  return 0;
}

function fmtCell(val: number, metric: Metric): string {
  if (val === 0) return '';
  if (metric === 'showrate') return formatPercent(val, 1);
  return String(val);
}

function showRateColor(val: number): string {
  if (val >= 60) return '#22c55e';
  if (val >= 30) return '#f59e0b';
  return '#ef4444';
}

function rowTotal(ch: ChannelCohort, metric: Metric): number {
  if (metric === 'showrate') {
    const totalCreated = ch.values.reduce((s, c) => s + c.created, 0);
    const totalDemoed  = ch.values.reduce((s, c) => s + c.demoed, 0);
    return totalCreated > 0 ? (totalDemoed / totalCreated) * 100 : 0;
  }
  return ch.values.reduce((s, c) => s + cellValue(c, metric), 0);
}

function totalRowValue(totals: CohortCell[], metric: Metric): number {
  if (metric === 'showrate') {
    const tc = totals.reduce((s, c) => s + c.created, 0);
    const td = totals.reduce((s, c) => s + c.demoed, 0);
    return tc > 0 ? (td / tc) * 100 : 0;
  }
  return totals.reduce((s, c) => s + cellValue(c, metric), 0);
}

/** Format a dollar amount for display in the close-date tables */
function fmtDollars(dollars: number | null): string {
  if (dollars === null || dollars === 0) return '—';
  return formatCurrency(Math.round(dollars * 100));
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  isDisabled,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  isDisabled?: (v: T) => boolean;
}) {
  return (
    <div
      className="flex overflow-hidden"
      style={{ border: '1px solid #e2e8f0', borderRadius: 9999 }}
    >
      {options.map((o) => {
        const disabled = isDisabled?.(o.value) ?? false;
        return (
          <button
            key={o.value}
            onClick={() => !disabled && onChange(o.value)}
            className="transition-colors"
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 500,
              background: value === o.value ? 'var(--color-primary)' : 'transparent',
              color: value === o.value ? '#ffffff' : disabled ? '#cbd5e1' : 'var(--color-neutral)',
              border: 'none',
              outline: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pill-style subtab navigation */
function SubtabBar({
  active,
  onChange,
}: {
  active: Subtab;
  onChange: (v: Subtab) => void;
}) {
  const tabs: { label: string; value: Subtab }[] = [
    { label: 'Pipeline Cohort',     value: 'cohort'    },
    { label: 'Pipeline – Close Date', value: 'closedate' },
  ];
  return (
    <div className="flex items-center gap-2">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          style={{
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 9999,
            border: active === t.value ? 'none' : '1px solid #e2e8f0',
            background: active === t.value ? 'var(--color-primary)' : 'transparent',
            color: active === t.value ? '#ffffff' : 'var(--color-neutral)',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Collapsible section header with optional ⓘ tooltip */
function CollapsibleSectionHeader({
  label,
  tooltip,
  open,
  onToggle,
}: {
  label:    string;
  tooltip?: string;
  open:     boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-bold text-white"
      style={{ background: 'var(--color-primary)' }}
    >
      <span className="flex items-center gap-2">
        {label}
        {tooltip && (
          <span
            title={tooltip}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 13,
              fontWeight: 400,
              opacity: 0.65,
              cursor: 'help',
              userSelect: 'none',
              lineHeight: 1,
            }}
            aria-label={tooltip}
          >
            ⓘ
          </span>
        )}
      </span>
      <span className="text-base leading-none opacity-70">{open ? '▾' : '▸'}</span>
    </button>
  );
}

/** Non-collapsible dark section header — matches Channel Costs tab style */
function SectionHeader({ label }: { label: string }) {
  return (
    <div
      className="w-full px-4 py-2.5 text-sm font-bold text-white"
      style={{ background: 'var(--color-primary)' }}
    >
      {label}
    </div>
  );
}

/** Light-theme select — matches the Dashboard / Channel Costs tab style */
function LightSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md focus:outline-none"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        padding: '6px 10px',
        fontSize: 12,
        color: 'var(--color-primary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
}

// ─── Cohort pivot table ───────────────────────────────────────────────────────

interface PivotTableProps {
  periods:  string[];
  channels: ChannelCohort[];
  totals:   CohortCell[];
  metric:   Metric;
  loading:  boolean;
}

function PivotTable({ periods, channels, totals, metric, loading }: PivotTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={scrollRef} className="overflow-x-auto" style={{ background: '#ffffff' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 px-4 py-2.5 text-left font-semibold"
              style={{
                background: '#ffffff',
                color: 'var(--color-neutral)',
                minWidth: 180,
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              Channel
            </th>
            {periods.map((p) => (
              <th
                key={p}
                className="px-3 py-2.5 text-right font-medium whitespace-nowrap"
                style={{ color: 'var(--color-neutral)', borderBottom: '1px solid #e2e8f0', minWidth: 64 }}
              >
                {p}
              </th>
            ))}
            <th
              className="px-4 py-2.5 text-right font-bold whitespace-nowrap"
              style={{ color: 'var(--color-neutral)', borderBottom: '1px solid #e2e8f0', minWidth: 64 }}
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td className="sticky left-0 px-4 py-2.5" style={{ background: '#ffffff' }}>
                  <div className="h-4 w-32 rounded animate-pulse" style={{ background: '#e2e8f0' }} />
                </td>
                {Array.from({ length: (periods.length || 4) + 1 }).map((_, j) => (
                  <td key={j} className="px-3 py-2.5">
                    <div className="h-4 w-8 ml-auto rounded animate-pulse" style={{ background: '#e2e8f0' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : channels.length === 0 ? (
            <tr>
              <td
                colSpan={periods.length + 2}
                className="px-4 py-8 text-center text-sm"
                style={{ color: 'var(--color-neutral)' }}
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
                    className="hover:bg-gray-50 transition-colors"
                    style={{ borderBottom: '1px solid #f1f5f9' }}
                  >
                    <td
                      className="sticky left-0 px-4 py-2 font-medium"
                      style={{ background: '#ffffff', color: 'var(--color-primary)', minWidth: 180 }}
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
                          style={{
                            color: v > 0
                              ? metric === 'showrate' ? showRateColor(v) : 'var(--color-primary)'
                              : '#cbd5e1',
                          }}
                        >
                          {v > 0 ? fmtCell(v, metric) : '—'}
                        </td>
                      );
                    })}
                    <td
                      className="px-4 py-2 text-right tabular-nums font-semibold"
                      style={{
                        color: rt > 0
                          ? metric === 'showrate' ? showRateColor(rt) : 'var(--color-primary)'
                          : '#cbd5e1',
                      }}
                    >
                      {rt > 0 ? fmtCell(rt, metric) : '—'}
                    </td>
                  </tr>
                );
              })}

              <tr style={{ background: 'var(--color-primary)' }}>
                <td
                  className="sticky left-0 px-4 py-2.5 font-bold text-white"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Total
                </td>
                {totals.map((cell, i) => {
                  const v = cellValue(cell, metric);
                  return (
                    <td
                      key={i}
                      className="px-3 py-2.5 text-right tabular-nums font-bold text-white"
                      style={{ opacity: v > 0 ? 1 : 0.4 }}
                    >
                      {v > 0 ? fmtCell(v, metric) : '—'}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                  {fmtCell(totalRowValue(totals, metric), metric) || '—'}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Close-date pivot table ───────────────────────────────────────────────────

type CloseDateMode = 'count' | 'arr' | 'asp';

interface CloseDateTableProps {
  periods:         string[];
  rows:            CloseDateRow[];
  portfolioValues: (number | null)[];
  mode:            CloseDateMode;
  footerLabel:     string;
  loading:         boolean;
  note?:           string;
}

function CloseDateTable({
  periods,
  rows,
  portfolioValues,
  mode,
  footerLabel,
  loading,
  note,
}: CloseDateTableProps) {
  function getCellValue(cell: CloseDateCell): number | null {
    if (mode === 'count') return cell.won_count;
    if (mode === 'arr')   return cell.arr;
    return cell.asp;
  }

  function getRowTotal(row: CloseDateRow): number | null {
    if (mode === 'count') return row.total_count;
    if (mode === 'arr')   return row.total_arr;
    return row.total_asp;
  }

  function fmtValue(v: number | null): string {
    if (v === null || v === 0) return '—';
    if (mode === 'count') return v.toLocaleString();
    return fmtDollars(v);
  }

  // Portfolio grand total for the "Total" column
  const portfolioTotal: number | null = (() => {
    if (mode === 'asp') {
      // weighted average: total ARR / total count across all periods
      const totalCount = rows.reduce((s, r) => s + r.total_count, 0);
      const totalArr   = rows.reduce((s, r) => s + r.total_arr,   0);
      return totalCount > 0 ? totalArr / totalCount : null;
    }
    return portfolioValues.reduce<number | null>((s, v) => {
      if (v === null) return s;
      return (s ?? 0) + v;
    }, null);
  })();

  const colCount = periods.length + 2; // channel + periods + total

  return (
    <div>
      <div className="overflow-x-auto" style={{ background: '#ffffff' }}>
        <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 px-4 py-2.5 text-left font-semibold"
                style={{
                  background: '#ffffff',
                  color: 'var(--color-neutral)',
                  minWidth: 180,
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                Channel
              </th>
              {periods.map((p) => (
                <th
                  key={p}
                  className="px-3 py-2.5 text-right font-medium whitespace-nowrap"
                  style={{ color: 'var(--color-neutral)', borderBottom: '1px solid #e2e8f0', minWidth: 80 }}
                >
                  {p}
                </th>
              ))}
              <th
                className="px-4 py-2.5 text-right font-bold whitespace-nowrap"
                style={{ color: 'var(--color-neutral)', borderBottom: '1px solid #e2e8f0', minWidth: 80 }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="sticky left-0 px-4 py-2.5" style={{ background: '#ffffff' }}>
                    <div className="h-4 w-32 rounded animate-pulse" style={{ background: '#e2e8f0' }} />
                  </td>
                  {Array.from({ length: (periods.length || 4) + 1 }).map((_, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-4 w-12 ml-auto rounded animate-pulse" style={{ background: '#e2e8f0' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-neutral)' }}>
                  No data
                </td>
              </tr>
            ) : (
              <>
                {rows.map((row) => {
                  const rowTotalVal = getRowTotal(row);
                  return (
                    <tr
                      key={row.channel}
                      className="hover:bg-gray-50 transition-colors"
                      style={{ borderBottom: '1px solid #f1f5f9' }}
                    >
                      <td
                        className="sticky left-0 px-4 py-2 font-medium"
                        style={{ background: '#ffffff', color: 'var(--color-primary)', minWidth: 180 }}
                      >
                        {row.channel}
                      </td>
                      {row.values.map((cell, i) => {
                        const v = getCellValue(cell);
                        const hasValue = v !== null && v !== 0;
                        return (
                          <td
                            key={i}
                            className="px-3 py-2 text-right tabular-nums"
                            style={{ color: hasValue ? 'var(--color-primary)' : '#cbd5e1' }}
                          >
                            {fmtValue(v)}
                          </td>
                        );
                      })}
                      <td
                        className="px-4 py-2 text-right tabular-nums font-semibold"
                        style={{ color: rowTotalVal !== null && rowTotalVal !== 0 ? 'var(--color-primary)' : '#cbd5e1' }}
                      >
                        {fmtValue(rowTotalVal)}
                      </td>
                    </tr>
                  );
                })}

                {/* Portfolio total footer */}
                <tr style={{ background: 'var(--color-primary)' }}>
                  <td
                    className="sticky left-0 px-4 py-2.5 font-bold text-white"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {footerLabel}
                  </td>
                  {portfolioValues.map((v, i) => (
                    <td
                      key={i}
                      className="px-3 py-2.5 text-right tabular-nums font-bold text-white"
                      style={{ opacity: v !== null && v !== 0 ? 1 : 0.4 }}
                    >
                      {fmtValue(v)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                    {fmtValue(portfolioTotal)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {note && (
        <p className="px-4 py-2 text-xs italic" style={{ color: 'var(--color-neutral)', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
          {note}
        </p>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function SalesforceClient() {
  // ── Subtab state ───────────────────────────────────────────────────────────
  const [activeSubtab, setActiveSubtab] = useState<Subtab>('cohort');

  // ── Unified filter state ───────────────────────────────────────────────────
  const [view,    setView]    = useState<View>('monthly');
  const [preset,  setPreset]  = useState<Preset>('12m');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [channel, setChannel] = useState('all');
  const [metric,  setMetric]  = useState<Metric>('created');

  // ── Reference data ─────────────────────────────────────────────────────────
  const [months, setMonths] = useState<string[]>([]);
  const initialized = useRef(false);

  // ── Cohort data ────────────────────────────────────────────────────────────
  const [cohort,        setCohort]        = useState<CohortResponse | null>(null);
  const [loadingCohort, setLoadingCohort] = useState(true);

  // ── Campaign data ──────────────────────────────────────────────────────────
  const [campaignData,     setCampaignData]     = useState<CampaignRow[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  // ── Close-date data ────────────────────────────────────────────────────────
  const [closeDateData,    setCloseDateData]    = useState<CloseDateResponse | null>(null);
  const [loadingCloseDate, setLoadingCloseDate] = useState(false);

  // ── Collapsible section state (all default open) ──────────────────────────
  const [mainOpen,      setMainOpen]      = useState(true);
  const [wonOpen,       setWonOpen]       = useState(true);
  const [demoOpen,      setDemoOpen]      = useState(true);
  const [showrateOpen,  setShowrateOpen]  = useState(true);
  const [stillOpenOpen, setStillOpenOpen] = useState(true);
  const [campaignOpen,  setCampaignOpen]  = useState(true);

  // ── KPI totals derived from cohort ────────────────────────────────────────
  const kpiTotalDemoed  = cohort?.totals.reduce((s, c) => s + c.demoed,  0) ?? 0;
  const kpiTotalCreated = cohort?.totals.reduce((s, c) => s + c.created, 0) ?? 0;
  const kpiShowRate     = kpiTotalCreated > 0
    ? (kpiTotalDemoed / kpiTotalCreated) * 100 : 0;

  const isQoQ = preset === 'qoq';

  // ── Period label shown inside KPI cards ───────────────────────────────────
  const periodLabel = from && to
    ? view === 'quarterly'
      ? monthToQuarterKey(from) === monthToQuarterKey(to)
        ? quarterKeyToLabel(monthToQuarterKey(from))
        : `${quarterKeyToLabel(monthToQuarterKey(from))} – ${quarterKeyToLabel(monthToQuarterKey(to))}`
      : view === 'yearly'
        ? from.slice(0, 4) === to.slice(0, 4)
          ? from.slice(0, 4)
          : `${from.slice(0, 4)} – ${to.slice(0, 4)}`
        : from === to
          ? formatMonthShort(from)
          : `${formatMonthShort(from)} – ${formatMonthShort(to)}`
    : '';

  // ── Fetch months list ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/salesforce/months')
      .then((r) => r.json())
      .then((d) => setMonths(d.months ?? []));
  }, []);

  // ── Initialize date range once months load (default: last 12 months) ──────
  useEffect(() => {
    if (months.length === 0 || initialized.current) return;
    initialized.current = true;
    const latest   = months[0];
    const earliest = months[months.length - 1];
    const from12   = addMonths(latest, -11);
    setTo(latest);
    setFrom(from12 < earliest ? earliest : from12);
    setPreset('12m');
  }, [months]);

  // ── Preset handler ─────────────────────────────────────────────────────────
  const applyPreset = useCallback((p: Preset) => {
    if (months.length === 0) return;
    const latest   = months[0];
    const earliest = months[months.length - 1];
    setPreset(p);

    let newFrom: string;
    const newTo = latest;
    let newView = view;

    if (p === 'qoq') {
      newView = 'quarterly';
      setView('quarterly');
      const qFrom = addMonths(latest, -14);
      newFrom = qFrom < earliest ? earliest : qFrom;
    } else if (p === 'all') {
      newFrom = earliest;
    } else {
      const delta = p === '6m' ? -5 : p === '12m' ? -11 : -23;
      const f = addMonths(latest, delta);
      newFrom = f < earliest ? earliest : f;
    }

    setFrom(snapFrom(newFrom, newView));
    setTo(snapTo(newTo, newView));
  }, [months, view]);

  // ── View change: snap from/to to the new view's period boundaries ──────────
  const handleViewChange = (v: View) => {
    if (isQoQ && v !== 'quarterly') return;
    setView(v);
    if (from) setFrom(snapFrom(from, v));
    if (to)   setTo(snapTo(to, v));
  };

  // ── Fetch cohort ───────────────────────────────────────────────────────────
  const fetchCohort = useCallback(async (v: View, f: string, t: string, ch: string) => {
    if (!f || !t) return;
    setLoadingCohort(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t, channel: ch });
      const res = await fetch(`/api/salesforce/channels?${params}`);
      const d: CohortResponse = await res.json();
      setCohort(d);
    } finally {
      setLoadingCohort(false);
    }
  }, []);

  useEffect(() => {
    if (from && to) fetchCohort(view, from, to, channel);
  }, [view, from, to, channel, fetchCohort]);

  // ── Fetch campaigns ────────────────────────────────────────────────────────
  const fetchCampaigns = useCallback(async (f: string, t: string, ch: string) => {
    if (!f || !t) return;
    setLoadingCampaigns(true);
    try {
      const params = new URLSearchParams({ from: f, to: t, channel: ch });
      const res = await fetch(`/api/salesforce/campaigns?${params}`);
      const d = await res.json();
      setCampaignData(d.rows ?? []);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    if (from && to) fetchCampaigns(from, to, channel);
  }, [from, to, channel, fetchCampaigns]);

  // ── Fetch close-date data ──────────────────────────────────────────────────
  const fetchCloseDate = useCallback(async (v: View, f: string, t: string) => {
    if (!f || !t) return;
    setLoadingCloseDate(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t });
      const res = await fetch(`/api/salesforce/close-date?${params}`);
      const d: CloseDateResponse = await res.json();
      setCloseDateData(d);
    } finally {
      setLoadingCloseDate(false);
    }
  }, []);

  useEffect(() => {
    if (from && to) fetchCloseDate(view, from, to);
  }, [view, from, to, fetchCloseDate]);

  // ── Campaign pivot (view-aware: groups months into quarters or years) ───────
  const { pivotPeriods, pivotSources, pivotMap } = useMemo(() => {
    const periodSet = new Set<string>();
    const sourceSet = new Set<string>();
    const map       = new Map<string, Map<string, number>>();

    function toPeriodKey(month: string): string {
      if (view === 'yearly')    return month.slice(0, 4);
      if (view === 'quarterly') return monthToQuarterKey(month);
      return month;
    }

    for (const row of campaignData) {
      const pk = toPeriodKey(row.created_month);
      periodSet.add(pk);
      sourceSet.add(row.campaign_source);
      if (!map.has(row.campaign_source)) map.set(row.campaign_source, new Map());
      const prev = map.get(row.campaign_source)!.get(pk) ?? 0;
      map.get(row.campaign_source)!.set(pk, prev + row.closed_won);
    }

    const pPeriods = [...periodSet].sort();
    const rowTotFn = (src: string) =>
      [...(map.get(src)?.values() ?? [])].reduce((s, v) => s + v, 0);

    const pSources = [...sourceSet].sort((a, b) => {
      if (a === '(no campaign)') return 1;
      if (b === '(no campaign)') return -1;
      return rowTotFn(b) - rowTotFn(a);
    });

    return { pivotPeriods: pPeriods, pivotSources: pSources, pivotMap: map };
  }, [campaignData, view]);

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-6 py-8 space-y-6" style={{ color: 'var(--color-primary)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="mt-1 text-sm max-w-lg" style={{ color: 'var(--color-neutral)' }}>
            {activeSubtab === 'cohort'
              ? 'Each column = opportunities created in that period; Won / Lost / Open figures show current outcome to-date. Recent cohorts are still maturing.'
              : 'Closed Won deals and ARR grouped by close date. Each period shows deals that closed in that window.'}
          </p>
        </div>

        {/* Metric toggle — only shown on cohort subtab */}
        {activeSubtab === 'cohort' && (
          <ToggleGroup<Metric>
            options={[
              { label: 'Opps Created', value: 'created'  },
              { label: 'Closed Won',   value: 'won'      },
              { label: 'Demos',        value: 'demoed'   },
              { label: 'Show Rate',    value: 'showrate' },
            ]}
            value={metric}
            onChange={setMetric}
          />
        )}
      </div>

      {/* ── Subtab navigation ────────────────────────────────────────────── */}
      <div className="space-y-1">
        <SubtabBar active={activeSubtab} onChange={setActiveSubtab} />
        <p className="text-xs italic px-1" style={{ color: 'var(--color-neutral)' }}>
          {activeSubtab === 'cohort'
            ? 'Opportunities and deals grouped by the month they were created.'
            : 'Closed Won deals and ARR grouped by the month the deal was closed.'}
        </p>
      </div>

      {/* ── Unified filter bar ───────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
        style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
      >
        {/* View toggle */}
        <ToggleGroup<View>
          options={[
            { label: 'Monthly',   value: 'monthly'   },
            { label: 'Quarterly', value: 'quarterly' },
            { label: 'Yearly',    value: 'yearly'    },
          ]}
          value={view}
          onChange={handleViewChange}
          isDisabled={(v) => isQoQ && v !== 'quarterly'}
        />

        <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Quick-range preset pills */}
        <ToggleGroup<Preset>
          options={[
            { label: 'Last 6M',  value: '6m'  },
            { label: 'Last 12M', value: '12m' },
            { label: 'Last 24M', value: '24m' },
            { label: 'QoQ',      value: 'qoq' },
            { label: 'All Time', value: 'all' },
          ]}
          value={preset}
          onChange={applyPreset}
        />

        <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

        {/* From / To dropdowns — adapt to active view */}
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-neutral)' }}>From</span>

          {view === 'quarterly' ? (() => {
            const quarters = monthsToQuarterKeys(months);
            const fromQ    = from ? monthToQuarterKey(from) : '';
            const toQ      = to   ? monthToQuarterKey(to)   : '';
            return (
              <LightSelect value={fromQ} onChange={(q) => { setFrom(quarterKeyToFrom(q)); setPreset('all'); }}>
                {quarters.filter((q) => !toQ || q <= toQ).map((q) => (
                  <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                ))}
              </LightSelect>
            );
          })() : view === 'yearly' ? (() => {
            const years = monthsToYears(months);
            const fromY = from ? from.slice(0, 4) : '';
            const toY   = to   ? to.slice(0, 4)   : '';
            return (
              <LightSelect value={fromY} onChange={(y) => { setFrom(`${y}-01`); setPreset('all'); }}>
                {years.filter((y) => !toY || y <= toY).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </LightSelect>
            );
          })() : (
            <LightSelect value={from} onChange={(v) => { setFrom(v); setPreset('all'); }}>
              {months.filter((m) => !to || m <= to).map((m) => (
                <option key={m} value={m}>{formatMonthShort(m)}</option>
              ))}
            </LightSelect>
          )}

          <span className="text-xs" style={{ color: 'var(--color-neutral)' }}>to</span>

          {view === 'quarterly' ? (() => {
            const quarters = monthsToQuarterKeys(months);
            const fromQ    = from ? monthToQuarterKey(from) : '';
            const toQ      = to   ? monthToQuarterKey(to)   : '';
            return (
              <LightSelect value={toQ} onChange={(q) => { setTo(quarterKeyToTo(q)); setPreset('all'); }}>
                {quarters.filter((q) => !fromQ || q >= fromQ).map((q) => (
                  <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                ))}
              </LightSelect>
            );
          })() : view === 'yearly' ? (() => {
            const years = monthsToYears(months);
            const fromY = from ? from.slice(0, 4) : '';
            const toY   = to   ? to.slice(0, 4)   : '';
            return (
              <LightSelect value={toY} onChange={(y) => { setTo(`${y}-12`); setPreset('all'); }}>
                {years.filter((y) => !fromY || y >= fromY).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </LightSelect>
            );
          })() : (
            <LightSelect value={to} onChange={(v) => { setTo(v); setPreset('all'); }}>
              {months.filter((m) => !from || m >= from).map((m) => (
                <option key={m} value={m}>{formatMonthShort(m)}</option>
              ))}
            </LightSelect>
          )}
        </div>

        {/* Channel filter — cohort subtab only */}
        {activeSubtab === 'cohort' && (
          <>
            <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />
            <LightSelect value={channel} onChange={setChannel}>
              <option value="all">All Channels</option>
              {KNOWN_CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </LightSelect>
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          SUBTAB 1 — Pipeline Cohort (existing content)
      ════════════════════════════════════════════════════════════════════ */}
      {activeSubtab === 'cohort' && (
        <>
          {/* ── KPI cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div
              className="rounded-xl px-5 py-4 flex flex-col gap-1 shadow-sm"
              style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'var(--color-neutral)' }}
                >
                  Demos
                </span>
                <span
                  title="Total marketing-sourced opportunities where a demo was completed in the selected period. A demo is recorded when the 'Demoed' field is set on the Salesforce opportunity. Counted by the month the opportunity was created, not the month the demo occurred."
                  style={{ fontSize: 12, color: '#cbd5e1', cursor: 'help', userSelect: 'none', lineHeight: 1 }}
                  aria-label="Demos definition"
                >
                  ⓘ
                </span>
              </div>
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: 'var(--color-primary)' }}
              >
                {loadingCohort ? '—' : kpiTotalDemoed.toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-neutral)' }}>
                total demoed
              </span>
              {periodLabel && (
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                  {periodLabel}
                </span>
              )}
            </div>

            <div
              className="rounded-xl px-5 py-4 flex flex-col gap-1 shadow-sm"
              style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'var(--color-neutral)' }}
                >
                  Show Rate
                </span>
                <span
                  title="Percentage of marketing-sourced opportunities that received a demo. Calculated as: Total Demos ÷ Total Opportunities Created × 100, across all channels in the selected period. Green ≥ 60 %, amber ≥ 30 %, red below 30 %."
                  style={{ fontSize: 12, color: '#cbd5e1', cursor: 'help', userSelect: 'none', lineHeight: 1 }}
                  aria-label="Show Rate definition"
                >
                  ⓘ
                </span>
              </div>
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: loadingCohort ? '#cbd5e1' : showRateColor(kpiShowRate) }}
              >
                {loadingCohort ? '—' : `${kpiShowRate.toFixed(1)}%`}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-neutral)' }}>
                demoed ÷ created
              </span>
              {periodLabel && (
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                  {periodLabel}
                </span>
              )}
            </div>
          </div>

          {/* ── Expand / Collapse All ─────────────────────────────────────── */}
          {(() => {
            const visibleCount =
              1 +
              (metric !== 'won'      ? 1 : 0) +
              (metric !== 'demoed'   ? 1 : 0) +
              (metric !== 'showrate' ? 1 : 0) +
              1 + // still open
              1;  // campaign

            const openCount =
              (mainOpen     ? 1 : 0) +
              (metric !== 'won'      ? (wonOpen      ? 1 : 0) : 0) +
              (metric !== 'demoed'   ? (demoOpen     ? 1 : 0) : 0) +
              (metric !== 'showrate' ? (showrateOpen ? 1 : 0) : 0) +
              (stillOpenOpen ? 1 : 0) +
              (campaignOpen  ? 1 : 0);

            const allOpen  = openCount === visibleCount;
            const allClose = openCount === 0;

            const expandAll = () => {
              setMainOpen(true); setWonOpen(true);
              setDemoOpen(true); setShowrateOpen(true); setStillOpenOpen(true); setCampaignOpen(true);
            };
            const collapseAll = () => {
              setMainOpen(false); setWonOpen(false);
              setDemoOpen(false); setShowrateOpen(false); setStillOpenOpen(false); setCampaignOpen(false);
            };

            return (
              <div className="flex justify-end gap-2">
                <button
                  onClick={expandAll}
                  disabled={allOpen}
                  className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Expand All
                </button>
                <button
                  onClick={collapseAll}
                  disabled={allClose}
                  className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Collapse All
                </button>
              </div>
            );
          })()}

          {/* ── Main cohort table ─────────────────────────────────────────── */}
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
            <CollapsibleSectionHeader
              label={
                metric === 'created'  ? 'Opportunities Created (count)' :
                metric === 'won'      ? 'Closed Won (count)'            :
                metric === 'demoed'   ? 'Demos (count)'                 :
                                        'Show Rate (%)'
              }
              tooltip={
                metric === 'created'
                  ? 'Count of marketing-sourced opportunities created each month, broken down by channel.'
                  : metric === 'won'
                  ? 'Count of marketing-sourced opportunities that reached "Closed Won" stage, grouped by the month the opportunity was originally created (cohort view).'
                  : metric === 'demoed'
                  ? 'Count of marketing-sourced opportunities where a demo was completed, grouped by the month the opportunity was created.'
                  : 'Percentage of marketing-sourced opportunities that received a demo, by channel and creation cohort.'
              }
              open={mainOpen}
              onToggle={() => setMainOpen((v) => !v)}
            />
            {mainOpen && (
              <PivotTable
                periods={cohort?.periods ?? []}
                channels={cohort?.channels ?? []}
                totals={cohort?.totals ?? []}
                metric={metric}
                loading={loadingCohort}
              />
            )}
          </div>

          {/* ── Demos — shown when metric ≠ demoed ───────────────────────── */}
          {metric !== 'demoed' && (
            <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
              <CollapsibleSectionHeader
                label="Demos (count)"
                tooltip="Count of marketing-sourced opportunities where a demo was completed, broken down by channel."
                open={demoOpen}
                onToggle={() => setDemoOpen((v) => !v)}
              />
              {demoOpen && (
                <PivotTable
                  periods={cohort?.periods ?? []}
                  channels={cohort?.channels ?? []}
                  totals={cohort?.totals ?? []}
                  metric="demoed"
                  loading={loadingCohort}
                />
              )}
            </div>
          )}

          {/* ── Closed Won — shown when metric ≠ won ─────────────────────── */}
          {metric !== 'won' && (
            <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
              <CollapsibleSectionHeader
                label="Closed Won by Channel"
                tooltip="Count of marketing-sourced deals that reached 'Closed Won' stage, broken down by channel. Grouped by the month the opportunity was created (cohort view)."
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

          {/* ── Show Rate — shown when metric ≠ showrate ─────────────────── */}
          {metric !== 'showrate' && (
            <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
              <CollapsibleSectionHeader
                label="Show Rate (%)"
                tooltip="Percentage of marketing-sourced opportunities that received a demo, broken down by channel."
                open={showrateOpen}
                onToggle={() => setShowrateOpen((v) => !v)}
              />
              {showrateOpen && (
                <PivotTable
                  periods={cohort?.periods ?? []}
                  channels={cohort?.channels ?? []}
                  totals={cohort?.totals ?? []}
                  metric="showrate"
                  loading={loadingCohort}
                />
              )}
            </div>
          )}

          {/* ── Cohort Still Open ────────────────────────────────────────── */}
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
            <CollapsibleSectionHeader
              label="Cohort Still Open — count"
              tooltip="Count of marketing-sourced opportunities that have not yet reached 'Closed Won' or 'Closed Lost', broken down by channel. Grouped by the month the opportunity was created. Recent cohorts will naturally show higher open counts."
              open={stillOpenOpen}
              onToggle={() => setStillOpenOpen((v) => !v)}
            />
            {stillOpenOpen && (
              <PivotTable
                periods={cohort?.periods ?? []}
                channels={cohort?.channels ?? []}
                totals={cohort?.totals ?? []}
                metric="open"
                loading={loadingCohort}
              />
            )}
          </div>

          {/* ── Opportunities by Campaign Source ─────────────────────────── */}
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
            <CollapsibleSectionHeader
              label="Opportunities by Campaign Source"
              tooltip="Count of marketing-sourced Closed Won deals broken down by campaign source. Grouped by the month the opportunity was created (cohort view)."
              open={campaignOpen}
              onToggle={() => setCampaignOpen((v) => !v)}
            />
            {campaignOpen && (
              <div className="overflow-x-auto" style={{ background: '#ffffff' }}>
                <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th
                        className="sticky left-0 z-10 px-4 py-2.5 text-left font-semibold"
                        style={{
                          background: '#ffffff',
                          color: 'var(--color-neutral)',
                          minWidth: 200,
                          borderBottom: '1px solid #e2e8f0',
                        }}
                      >
                        Campaign Source
                      </th>
                      {pivotPeriods.map((p) => (
                        <th
                          key={p}
                          className="px-3 py-2.5 text-right whitespace-nowrap font-medium"
                          style={{ color: 'var(--color-neutral)', borderBottom: '1px solid #e2e8f0', minWidth: 56 }}
                        >
                          {view === 'quarterly' ? quarterKeyToLabel(p) : view === 'yearly' ? p : formatMonthShort(p)}
                        </th>
                      ))}
                      <th
                        className="px-4 py-2.5 text-right font-bold"
                        style={{ color: 'var(--color-neutral)', borderBottom: '1px solid #e2e8f0', minWidth: 56 }}
                      >
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingCampaigns ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td className="sticky left-0 px-4 py-2.5" style={{ background: '#ffffff' }}>
                            <div className="h-4 w-36 rounded animate-pulse" style={{ background: '#e2e8f0' }} />
                          </td>
                          {Array.from({ length: (pivotPeriods.length || 4) + 1 }).map((_, j) => (
                            <td key={j} className="px-3 py-2.5">
                              <div className="h-4 w-8 ml-auto rounded animate-pulse" style={{ background: '#e2e8f0' }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : pivotSources.length === 0 ? (
                      <tr>
                        <td
                          colSpan={pivotPeriods.length + 2}
                          className="px-4 py-8 text-center text-sm"
                          style={{ color: 'var(--color-neutral)' }}
                        >
                          No data
                        </td>
                      </tr>
                    ) : (
                      <>
                        {pivotSources.map((src) => {
                          const rowMap = pivotMap.get(src) ?? new Map();
                          const rt     = [...rowMap.values()].reduce((s, v) => s + v, 0);
                          const isNo   = src === '(no campaign)';
                          return (
                            <tr
                              key={src}
                              className="hover:bg-gray-50 transition-colors"
                              style={{ borderBottom: '1px solid #f1f5f9' }}
                            >
                              <td
                                className="sticky left-0 px-4 py-2 font-medium truncate max-w-[220px]"
                                style={{
                                  background: '#ffffff',
                                  color: isNo ? 'var(--color-neutral)' : 'var(--color-primary)',
                                }}
                              >
                                {src}
                              </td>
                              {pivotPeriods.map((p) => {
                                const v = rowMap.get(p) ?? 0;
                                return (
                                  <td
                                    key={p}
                                    className="px-3 py-2 text-right tabular-nums"
                                    style={{ color: v > 0 ? 'var(--color-primary)' : '#cbd5e1' }}
                                  >
                                    {v > 0 ? v : '—'}
                                  </td>
                                );
                              })}
                              <td
                                className="px-4 py-2 text-right tabular-nums font-semibold"
                                style={{ color: rt > 0 ? 'var(--color-primary)' : '#cbd5e1' }}
                              >
                                {rt > 0 ? rt : '—'}
                              </td>
                            </tr>
                          );
                        })}

                        <tr style={{ background: 'var(--color-primary)' }}>
                          <td
                            className="sticky left-0 px-4 py-2.5 font-bold text-white"
                            style={{ background: 'var(--color-primary)' }}
                          >
                            Total
                          </td>
                          {pivotPeriods.map((p) => {
                            const colTotal = pivotSources.reduce(
                              (s, src) => s + (pivotMap.get(src)?.get(p) ?? 0),
                              0
                            );
                            return (
                              <td
                                key={p}
                                className="px-3 py-2.5 text-right tabular-nums font-bold text-white"
                                style={{ opacity: colTotal > 0 ? 1 : 0.4 }}
                              >
                                {colTotal > 0 ? colTotal : '—'}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-white">
                            {(() => {
                              const gt = pivotPeriods.reduce(
                                (s, p) => s + pivotSources.reduce((ss, src) => ss + (pivotMap.get(src)?.get(p) ?? 0), 0),
                                0
                              );
                              return gt > 0 ? gt : '—';
                            })()}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SUBTAB 2 — Pipeline - Close Date
      ════════════════════════════════════════════════════════════════════ */}
      {activeSubtab === 'closedate' && (
        <div className="space-y-6">

          {/* Table 1 — Closed Won Deals (count) */}
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
            <SectionHeader label="Closed Won Deals (count)" />
            <CloseDateTable
              periods={closeDateData?.periods ?? []}
              rows={closeDateData?.rows ?? []}
              portfolioValues={closeDateData?.portfolio_count ?? []}
              mode="count"
              footerLabel="Portfolio Total"
              loading={loadingCloseDate}
            />
          </div>

          {/* Table 2 — Closed Won ARR ($) */}
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
            <SectionHeader label="Closed Won ARR ($)" />
            <CloseDateTable
              periods={closeDateData?.periods ?? []}
              rows={closeDateData?.rows ?? []}
              portfolioValues={closeDateData?.portfolio_arr ?? []}
              mode="arr"
              footerLabel="Portfolio Total ARR"
              loading={loadingCloseDate}
            />
          </div>

          {/* Table 3 — ASP */}
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid #e2e8f0' }}>
            <SectionHeader label="ASP — Avg ARR per Won Deal ($)" />
            <CloseDateTable
              periods={closeDateData?.periods ?? []}
              rows={closeDateData?.rows ?? []}
              portfolioValues={closeDateData?.portfolio_asp ?? []}
              mode="asp"
              footerLabel="Portfolio ASP"
              loading={loadingCloseDate}
              note="ASP = Closed Won ARR ÷ Closed Won Deals, by close date"
            />
          </div>

        </div>
      )}

    </div>
  );
}
