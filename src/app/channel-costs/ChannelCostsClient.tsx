'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatMonth, formatMonthShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ChannelDetailResponse, ChannelDetailRow } from '@/app/api/channel-costs/route';

type View = 'monthly' | 'quarterly' | 'yearly';
type PeriodType = 'accounting' | 'transaction';

const PERIOD_LABELS: Record<PeriodType, string> = {
  accounting:  'Accounting Period',
  transaction: 'Transaction Date',
};
const PERIOD_TOOLTIPS: Record<PeriodType, string> = {
  accounting:  'Groups spend by the period it was booked in NetSuite',
  transaction: 'Groups spend by when the transaction actually occurred',
};

const CHANNEL_ORDER = [
  'Paid Search',
  'Paid Social',
  'SEO / Organic',
  'Web Direct',
  'Review Sites',
  'Trade Show',
  'Referral',
  'Email',
  'Partner',
  'Other',
  'Sales Development',
];

function monthKeyToPeriod(monthKey: string, view: View): string {
  const year = monthKey.slice(0, 4);
  const month = parseInt(monthKey.slice(5, 7), 10);
  if (view === 'yearly') return year;
  if (view === 'quarterly') return `Q${Math.ceil(month / 3)} ${year}`;
  return formatMonth(monthKey);
}

function sortPeriods(periods: string[], view: View): string[] {
  return [...periods].sort((a, b) => {
    if (view === 'yearly') return a.localeCompare(b);
    if (view === 'quarterly') {
      const toKey = (s: string) => `${s.slice(3)}${s.slice(0, 2)}`;
      return toKey(a).localeCompare(toKey(b));
    }
    return new Date(a).getTime() - new Date(b).getTime();
  });
}

function fmt(n: number) {
  return n === 0 ? '—' : formatCurrency(n * 100);
}

interface PivotEntry {
  financial_row: string;
  entity_name: string;
  values: number[];
  total: number;
}

interface GlGroup {
  financial_row: string;
  entries: PivotEntry[];
  subtotalValues: number[];
  subtotalTotal: number;
}

function buildGlGroups(rows: ChannelDetailRow[], periods: string[], view: View): GlGroup[] {
  const matrix = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const period = monthKeyToPeriod(r.month_key, view);
    const key = `${r.financial_row}|||${r.entity_name}`;
    if (!matrix.has(key)) matrix.set(key, new Map());
    const pm = matrix.get(key)!;
    pm.set(period, (pm.get(period) ?? 0) + r.amount);
  }

  const glMap = new Map<string, PivotEntry[]>();
  for (const [key, pm] of matrix) {
    const [fr, en] = key.split('|||');
    const values = periods.map((p) => pm.get(p) ?? 0);
    const entry: PivotEntry = { financial_row: fr, entity_name: en, values, total: values.reduce((s, v) => s + v, 0) };
    const arr = glMap.get(fr) ?? [];
    arr.push(entry);
    glMap.set(fr, arr);
  }

  const groups: GlGroup[] = [];
  for (const [fr, entries] of glMap) {
    entries.sort((a, b) => b.total - a.total);
    const subtotalValues = periods.map((_, i) => entries.reduce((s, e) => s + e.values[i], 0));
    groups.push({
      financial_row: fr,
      entries,
      subtotalValues,
      subtotalTotal: subtotalValues.reduce((s, v) => s + v, 0),
    });
  }
  groups.sort((a, b) => b.subtotalTotal - a.subtotalTotal);
  return groups;
}

function PivotTable({ rows, view }: { rows: ChannelDetailRow[]; view: View }) {
  const { periods, glGroups, grandValues, grandTotal } = useMemo(() => {
    const periodSet = new Set<string>();
    rows.forEach((r) => periodSet.add(monthKeyToPeriod(r.month_key, view)));
    const p = sortPeriods([...periodSet], view);
    const gl = buildGlGroups(rows, p, view);
    const gv = p.map((_, i) => gl.reduce((s, g) => s + g.subtotalValues[i], 0));
    return { periods: p, glGroups: gl, grandValues: gv, grandTotal: gv.reduce((s, v) => s + v, 0) };
  }, [rows, view]);

  const latestIdx = periods.length - 1;

  if (glGroups.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-gray-400">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[300px]">
              GL Account / Vendor
            </th>
            {periods.map((p, i) => (
              <th
                key={p}
                className={cn(
                  'px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap',
                  i === latestIdx && 'bg-gray-700'
                )}
              >
                {p}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {glGroups.map((group) => (
            <>
              <tr key={`gl-${group.financial_row}`} className="bg-gray-100">
                <td className="sticky left-0 z-10 bg-gray-100 px-4 py-2 text-left">
                  <span className="text-xs font-medium text-gray-600 font-mono">{group.financial_row}</span>
                </td>
                {group.subtotalValues.map((v, i) => (
                  <td key={i} className={cn(
                    'px-4 py-2 text-right tabular-nums text-xs text-gray-500',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}>
                    {fmt(v)}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tabular-nums text-xs font-medium text-gray-600">
                  {fmt(group.subtotalTotal)}
                </td>
              </tr>
              {group.entries.map((entry, ei) => (
                <tr key={`v-${group.financial_row}-${ei}`} className="bg-white hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 text-left pl-8">
                    {entry.entity_name}
                  </td>
                  {entry.values.map((v, i) => (
                    <td key={i} className={cn(
                      'px-4 py-2 text-right tabular-nums whitespace-nowrap',
                      v === 0 && 'text-gray-300',
                      i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                    )}>
                      {fmt(v)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                    {fmt(entry.total)}
                  </td>
                </tr>
              ))}
              {group.entries.length > 1 && (
                <tr key={`sub-${group.financial_row}`} className="bg-gray-50">
                  <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-left pl-8">
                    <span className="font-semibold italic text-gray-600">Subtotal — {group.financial_row}</span>
                  </td>
                  {group.subtotalValues.map((v, i) => (
                    <td key={i} className={cn(
                      'px-4 py-2 text-right tabular-nums font-semibold italic whitespace-nowrap',
                      i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                    )}>
                      {fmt(v)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums font-bold italic whitespace-nowrap">
                    {fmt(group.subtotalTotal)}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold">
              Grand Total
            </td>
            {grandValues.map((v, i) => (
              <td key={i} className="px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap">
                {fmt(v)}
              </td>
            ))}
            <td className="px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap">
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface ChannelGroup {
  channel: string;
  rows: ChannelDetailRow[];
  periodTotals: number[];
  total: number;
  glGroups: GlGroup[];
}

function AllChannelsView({ rows, view }: { rows: ChannelDetailRow[]; view: View }) {
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());

  const { groups, periods, grandValues, grandTotal } = useMemo(() => {
    const periodSet = new Set<string>();
    rows.forEach((r) => periodSet.add(monthKeyToPeriod(r.month_key, view)));
    const sortedPeriods = sortPeriods([...periodSet], view);

    const map = new Map<string, ChannelDetailRow[]>();
    for (const row of rows) {
      const ch = row.channel ?? 'Other';
      const arr = map.get(ch) ?? [];
      arr.push(row);
      map.set(ch, arr);
    }

    const sorted: ChannelGroup[] = [];
    const addChannel = (ch: string, chRows: ChannelDetailRow[]) => {
      const gl = buildGlGroups(chRows, sortedPeriods, view);
      const periodTotals = sortedPeriods.map((_, i) => gl.reduce((s, g) => s + g.subtotalValues[i], 0));
      sorted.push({
        channel: ch,
        rows: chRows,
        periodTotals,
        total: periodTotals.reduce((s, v) => s + v, 0),
        glGroups: gl,
      });
    };

    for (const ch of CHANNEL_ORDER) {
      const chRows = map.get(ch);
      if (chRows && chRows.length > 0) addChannel(ch, chRows);
    }
    for (const [ch, chRows] of map) {
      if (!CHANNEL_ORDER.includes(ch) && chRows.length > 0) addChannel(ch, chRows);
    }

    const gv = sortedPeriods.map((_, i) => sorted.reduce((s, g) => s + g.periodTotals[i], 0));
    return { groups: sorted, periods: sortedPeriods, grandValues: gv, grandTotal: gv.reduce((s, v) => s + v, 0) };
  }, [rows, view]);

  const latestIdx = periods.length - 1;
  const allOpen = groups.length > 0 && groups.every((g) => openChannels.has(g.channel));
  const expandAll = () => setOpenChannels(new Set(groups.map((g) => g.channel)));
  const collapseAll = () => setOpenChannels(new Set());
  const toggle = (ch: string) => {
    setOpenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <button
          onClick={expandAll}
          disabled={allOpen}
          className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          disabled={openChannels.size === 0}
          className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Collapse All
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-800 text-white">
              <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[300px]">
                Channel / GL Account / Vendor
              </th>
              {periods.map((p, i) => (
                <th
                  key={p}
                  className={cn(
                    'px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap',
                    i === latestIdx && 'bg-gray-700'
                  )}
                >
                  {p}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide">
                Total
              </th>
              <th className="px-2 py-3 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((group) => {
              const isOpen = openChannels.has(group.channel);
              return (
                <ChannelAccordionRows
                  key={group.channel}
                  group={group}
                  isOpen={isOpen}
                  onToggle={() => toggle(group.channel)}
                  latestIdx={latestIdx}
                  periods={periods}
                />
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--color-primary)] text-white">
              <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold">
                Grand Total
              </td>
              {grandValues.map((v, i) => (
                <td key={i} className="px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap">
                  {fmt(v)}
                </td>
              ))}
              <td className="px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap">
                {fmt(grandTotal)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ChannelAccordionRows({ group, isOpen, onToggle, latestIdx }: {
  group: ChannelGroup;
  isOpen: boolean;
  onToggle: () => void;
  latestIdx: number;
  periods: string[];
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="bg-[var(--color-band,#f0f4f8)] cursor-pointer hover:bg-[var(--color-band-hover,#e2e8f0)] transition-colors"
      >
        <td className="sticky left-0 z-10 bg-[var(--color-band,#f0f4f8)] px-4 py-3 text-left font-bold text-gray-900">
          {group.channel}
        </td>
        {group.periodTotals.map((v, i) => (
          <td key={i} className={cn(
            'px-4 py-3 text-right tabular-nums font-semibold whitespace-nowrap',
            v === 0 && 'text-gray-300',
            i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
          )}>
            {fmt(v)}
          </td>
        ))}
        <td className="px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap">
          {fmt(group.total)}
        </td>
        <td className="px-2 py-3 text-center">
          <span className={cn(
            'inline-block text-gray-400 transition-transform duration-200 text-xs',
            isOpen && 'rotate-180'
          )}>
            ▼
          </span>
        </td>
      </tr>
      {isOpen && group.glGroups.map((gl) => (
        <GlGroupRows key={gl.financial_row} gl={gl} channelName={group.channel} latestIdx={latestIdx} />
      ))}
    </>
  );
}

function GlGroupRows({ gl, channelName, latestIdx }: { gl: GlGroup; channelName: string; latestIdx: number }) {
  return (
    <>
      <tr className="bg-gray-100">
        <td className="sticky left-0 z-10 bg-gray-100 px-4 py-2 text-left pl-6">
          <span className="text-xs font-medium text-gray-600 font-mono">{gl.financial_row}</span>
        </td>
        {gl.subtotalValues.map((v, i) => (
          <td key={i} className={cn(
            'px-4 py-2 text-right tabular-nums text-xs text-gray-500',
            i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
          )}>
            {fmt(v)}
          </td>
        ))}
        <td className="px-4 py-2 text-right tabular-nums text-xs font-medium text-gray-600">
          {fmt(gl.subtotalTotal)}
        </td>
        <td />
      </tr>
      {gl.entries.map((entry, ei) => (
        <tr key={`${channelName}-${gl.financial_row}-${ei}`} className="bg-white hover:bg-gray-50">
          <td className="sticky left-0 z-10 bg-white px-4 py-2 text-left pl-10">
            {entry.entity_name}
          </td>
          {entry.values.map((v, i) => (
            <td key={i} className={cn(
              'px-4 py-2 text-right tabular-nums whitespace-nowrap',
              v === 0 && 'text-gray-300',
              i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
            )}>
              {fmt(v)}
            </td>
          ))}
          <td className="px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap">
            {fmt(entry.total)}
          </td>
          <td />
        </tr>
      ))}
      {gl.entries.length > 1 && (
        <tr className="bg-gray-50">
          <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-left pl-10">
            <span className="font-semibold italic text-gray-600">Subtotal</span>
          </td>
          {gl.subtotalValues.map((v, i) => (
            <td key={i} className={cn(
              'px-4 py-2 text-right tabular-nums font-semibold italic whitespace-nowrap',
              i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
            )}>
              {fmt(v)}
            </td>
          ))}
          <td className="px-4 py-2 text-right tabular-nums font-bold italic whitespace-nowrap">
            {fmt(gl.subtotalTotal)}
          </td>
          <td />
        </tr>
      )}
    </>
  );
}

export default function ChannelCostsClient() {
  const [channel, setChannel] = useState('all');
  const [view, setView] = useState<View>('quarterly');
  const [year, setYear] = useState('all');
  const [monthKey, setMonthKey] = useState('all');
  const [months, setMonths] = useState<string[]>([]);
  const [periodType, setPeriodType] = useState<PeriodType>('transaction');
  const [monthsLoading, setMonthsLoading] = useState(false);
  const [data, setData] = useState<ChannelDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch the months list when period type changes; reset the month selector
  useEffect(() => {
    setMonthsLoading(true);
    fetch(`/api/channel-costs/months?period_type=${periodType}`)
      .then((r) => r.json())
      .then((j) => setMonths(j.months ?? []))
      .catch(() => {})
      .finally(() => setMonthsLoading(false));
  }, [periodType]);

  const isSpecificMonth = monthKey !== 'all';
  const effectiveView: View = isSpecificMonth ? 'monthly' : view;

  const fetchData = useCallback(async (ch: string, y: string, mk: string, pt: PeriodType) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (ch !== 'all') params.set('channel', ch);
      if (mk !== 'all') {
        params.set('month_key', mk);
      } else if (y !== 'all') {
        params.set('year', y);
      }
      params.set('period_type', pt);
      const res = await fetch(`/api/channel-costs?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(channel, year, monthKey, periodType);
  }, [fetchData, channel, year, monthKey, periodType]);

  const handleViewChange = (v: View) => {
    setView(v);
    setMonthKey('all');
  };

  const handleYearChange = (y: string) => {
    setYear(y);
    if (y === 'all') setMonthKey('all');
  };

  const handleMonthKeyChange = (mk: string) => {
    setMonthKey(mk);
  };

  const handlePeriodTypeChange = (pt: PeriodType) => {
    setPeriodType(pt);
    setMonthKey('all'); // reset month selector — periods may differ between modes
  };

  const showingLabel = useMemo(() => {
    if (!isSpecificMonth) return null;
    return formatMonth(monthKey);
  }, [isSpecificMonth, monthKey]);

  const exportCsv = useCallback(() => {
    if (!data || data.rows.length === 0) return;
    const periodSet = new Set<string>();
    data.rows.forEach((r) => periodSet.add(monthKeyToPeriod(r.month_key, effectiveView)));
    const periods = sortPeriods([...periodSet], effectiveView);

    const isAll = channel === 'all';
    const headerCols = isAll
      ? ['Channel', 'GL Account', 'Vendor', ...periods, 'Total']
      : ['GL Account', 'Vendor', ...periods, 'Total'];
    const header = headerCols.join(',');

    const matrix = new Map<string, Map<string, number>>();
    for (const r of data.rows) {
      const key = isAll
        ? `${r.channel}|||${r.financial_row}|||${r.entity_name}`
        : `${r.financial_row}|||${r.entity_name}`;
      if (!matrix.has(key)) matrix.set(key, new Map());
      const pm = matrix.get(key)!;
      const period = monthKeyToPeriod(r.month_key, effectiveView);
      pm.set(period, (pm.get(period) ?? 0) + r.amount);
    }

    const lines: string[] = [];
    for (const [key, pm] of matrix) {
      const parts = key.split('|||');
      const values = periods.map((p) => pm.get(p) ?? 0);
      const total = values.reduce((s, v) => s + v, 0);
      const row = [...parts.map((p) => `"${p}"`), ...values.map(String), String(total)];
      lines.push(row.join(','));
    }

    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `channel-costs-${channel}-${effectiveView}-${monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, channel, effectiveView, monthKey]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">Channel Costs</h1>
          {showingLabel && (
            <span className="text-sm text-[var(--color-primary)] font-medium bg-[var(--color-primary)]/10 px-2 py-1 rounded">
              Showing: {showingLabel}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          >
            <option value="all">All Channels</option>
            {CHANNEL_ORDER.map((ch) => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>

          {/* Period type toggle */}
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-md border border-[var(--color-neutral)] overflow-hidden text-sm">
              {(['accounting', 'transaction'] as PeriodType[]).map((pt) => (
                <button
                  key={pt}
                  onClick={() => handlePeriodTypeChange(pt)}
                  className={cn(
                    'px-3 py-2 whitespace-nowrap transition-colors',
                    periodType === pt
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {PERIOD_LABELS[pt]}
                </button>
              ))}
            </div>
            <span
              title={PERIOD_TOOLTIPS[periodType]}
              className="cursor-help select-none text-sm text-gray-400 hover:text-gray-600"
              aria-label="Period type explanation"
            >
              ⓘ
            </span>
          </div>

          {!isSpecificMonth && (
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-sm">
              {(['monthly', 'quarterly', 'yearly'] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => handleViewChange(v)}
                  className={cn(
                    'px-4 py-2 capitalize transition-colors',
                    view === v
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          <select
            value={year}
            onChange={(e) => handleYearChange(e.target.value)}
            disabled={isSpecificMonth}
            className={cn(
              'rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]',
              isSpecificMonth && 'opacity-50 cursor-not-allowed'
            )}
          >
            <option value="all">All Years</option>
            {(data?.years ?? []).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <div className="relative">
            <select
              value={monthKey}
              disabled={monthsLoading}
              onChange={(e) => handleMonthKeyChange(e.target.value)}
              className={cn(
                'rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]',
                monthsLoading && 'opacity-60 cursor-wait'
              )}
            >
              <option value="all">All Months</option>
              {months.map((mk) => (
                <option key={mk} value={mk}>{formatMonthShort(mk)}</option>
              ))}
            </select>
            {monthsLoading && (
              <span className="pointer-events-none absolute inset-y-0 right-6 flex items-center">
                <svg className="h-3.5 w-3.5 animate-spin text-[var(--color-primary)]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </span>
            )}
          </div>

          <button
            onClick={exportCsv}
            disabled={!data || data.rows.length === 0}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Content */}
      {!loading && data && (
        data.rows.length === 0 ? (
          <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-gray-400">
            No data for the selected filters.
          </div>
        ) : channel === 'all' ? (
          <AllChannelsView rows={data.rows} view={effectiveView} />
        ) : (
          <PivotTable rows={data.rows} view={effectiveView} />
        )
      )}
    </div>
  );
}
