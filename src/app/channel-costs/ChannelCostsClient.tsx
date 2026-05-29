'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatMonth, formatMonthShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ChannelDetailResponse, ChannelDetailRow } from '@/app/api/channel-costs/route';
import type { CacResponse, CacCostRow, ArrRow, AllOppRow } from '@/app/api/channel-costs/cac/route';

type View       = 'monthly' | 'quarterly' | 'yearly';
type PeriodType = 'accounting' | 'transaction';
type Preset     = '6m' | '12m' | '24m' | 'qoq' | 'all';
type Subtab     = 'cohort' | 'closedate';

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
  'Referral/Partner',
  'Email',
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

// Remap NS cost channel labels to the unified display labels used by CAC_CHANNEL_ORDER
// and matching the Pipeline tab's CHANNEL_ORDER.
function normalizeChannel(ch: string): string {
  if (ch === 'Partner' || ch === 'Referral') return 'Partner / Referral';
  return ch;
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

function addMonthsHelper(mk: string, delta: number): string {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

function fmt(n: number) {
  return n === 0 ? '—' : formatCurrency(n * 100);
}

// ─── Shared UI primitives (Pipeline style) ────────────────────────────────────

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  isDisabled,
}: {
  options: { label: string; value: T }[];
  value:   T;
  onChange: (v: T) => void;
  isDisabled?: (v: T) => boolean;
}) {
  return (
    <div className="flex overflow-hidden" style={{ border: '1px solid #e2e8f0', borderRadius: 9999 }}>
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
              color:      value === o.value ? '#ffffff' : disabled ? '#cbd5e1' : 'var(--color-neutral)',
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

function LightSelect({
  value,
  onChange,
  disabled,
  children,
}: {
  value:    string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md focus:outline-none"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        padding: '6px 10px',
        fontSize: 12,
        color: disabled ? '#94a3b8' : 'var(--color-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </select>
  );
}

function SubtabBar({ active, onChange }: { active: Subtab; onChange: (v: Subtab) => void }) {
  const tabs: { label: string; value: Subtab }[] = [
    { label: 'Channel Cohort',       value: 'cohort'    },
    { label: 'Channel – Close Date', value: 'closedate' },
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

function useAutoScrollRight(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

function PivotTable({ rows, view, allinSmRows = [] }: {
  rows: ChannelDetailRow[];
  view: View;
  allinSmRows?: { month_key: string; total_sm: number }[];
}) {
  const { periods, glGroups, grandValues, grandTotal, smValues, smTotal } = useMemo(() => {
    const periodSet = new Set<string>();
    rows.forEach((r) => periodSet.add(monthKeyToPeriod(r.month_key, view)));
    const p = sortPeriods([...periodSet], view);
    const gl = buildGlGroups(rows, p, view);
    const gv = p.map((_, i) => gl.reduce((s, g) => s + g.subtotalValues[i], 0));

    // Compute All-in S&M per display period
    const smByPeriod = new Map<string, number>();
    for (const r of allinSmRows) {
      const label = monthKeyToPeriod(r.month_key, view);
      smByPeriod.set(label, (smByPeriod.get(label) ?? 0) + r.total_sm);
    }
    const smValues = p.map(period => smByPeriod.get(period) ?? null);
    const smTotal  = smValues.reduce<number>((s, v) => s + (v ?? 0), 0) || null;

    return { periods: p, glGroups: gl, grandValues: gv, grandTotal: gv.reduce((s, v) => s + v, 0), smValues, smTotal };
  }, [rows, view, allinSmRows]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (glGroups.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-gray-400">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
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
              <tr key={`gl-${group.financial_row}`} className="bg-[var(--color-band)]">
                <td className="sticky left-0 z-10 bg-[var(--color-band)] px-4 py-2 text-left">
                  <span className="text-xs font-medium text-[var(--color-primary)] font-mono">{group.financial_row}</span>
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
          {allinSmRows.length > 0 && (
            <tr className="bg-[var(--color-primary)] text-white">
              <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-2.5 text-left font-semibold text-sm border-t border-white/20">
                All-in S&M Spend ($)
              </td>
              {smValues.map((v, i) => (
                <td key={i} className={cn('px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap border-t border-white/20', v === null && 'opacity-40')}>
                  {v === null ? '—' : formatCurrency(v * 100)}
                </td>
              ))}
              <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap border-t border-white/20', smTotal === null && 'opacity-40')}>
                {smTotal === null ? '—' : formatCurrency(smTotal * 100)}
              </td>
            </tr>
          )}
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

function AllChannelsView({ rows, view, allinSmRows = [] }: {
  rows: ChannelDetailRow[];
  view: View;
  allinSmRows?: { month_key: string; total_sm: number }[];
}) {
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());

  const { groups, periods, grandValues, grandTotal, smValues, smTotal } = useMemo(() => {
    const periodSet = new Set<string>();
    rows.forEach((r) => periodSet.add(monthKeyToPeriod(r.month_key, view)));
    const sortedPeriods = sortPeriods([...periodSet], view);

    const map = new Map<string, ChannelDetailRow[]>();
    for (const row of rows) {
      const ch = normalizeChannel(row.channel ?? 'Other');
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

    // Compute All-in S&M per display period
    const smByPeriod = new Map<string, number>();
    for (const r of allinSmRows) {
      const label = monthKeyToPeriod(r.month_key, view);
      smByPeriod.set(label, (smByPeriod.get(label) ?? 0) + r.total_sm);
    }
    const smValues = sortedPeriods.map(period => smByPeriod.get(period) ?? null);
    const smTotal  = smValues.reduce<number>((s, v) => s + (v ?? 0), 0) || null;

    return { groups: sorted, periods: sortedPeriods, grandValues: gv, grandTotal: gv.reduce((s, v) => s + v, 0), smValues, smTotal };
  }, [rows, view, allinSmRows]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);
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

      <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
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
            {allinSmRows.length > 0 && (
              <tr className="bg-[var(--color-primary)] text-white">
                <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-2.5 text-left font-semibold text-sm border-t border-white/20">
                  All-in S&M Spend ($)
                </td>
                {smValues.map((v, i) => (
                  <td key={i} className={cn('px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap border-t border-white/20', v === null && 'opacity-40')}>
                    {v === null ? '—' : formatCurrency(v * 100)}
                  </td>
                ))}
                <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap border-t border-white/20', smTotal === null && 'opacity-40')}>
                  {smTotal === null ? '—' : formatCurrency(smTotal * 100)}
                </td>
                <td />
              </tr>
            )}
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
        className="bg-[var(--color-band)] border-t border-b border-gray-300 cursor-pointer hover:brightness-95 transition-[filter]"
      >
        <td className="sticky left-0 z-10 bg-[var(--color-band)] px-4 py-3 text-left font-bold text-[var(--color-primary)]">
          {group.channel}
        </td>
        {group.periodTotals.map((v, i) => (
          <td key={i} className={cn(
            'px-4 py-3 text-right tabular-nums font-semibold whitespace-nowrap',
            v === 0 ? 'text-[var(--color-neutral)]' : 'text-[var(--color-primary)]',
            i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
          )}>
            {fmt(v)}
          </td>
        ))}
        <td className="px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap text-[var(--color-primary)]">
          {fmt(group.total)}
        </td>
        <td className="px-2 py-3 text-center">
          <span className={cn(
            'inline-block text-[var(--color-neutral)] transition-transform duration-200 text-xs',
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
      <tr className="bg-[var(--color-band)]">
        <td className="sticky left-0 z-10 bg-[var(--color-band)] px-4 py-2 text-left pl-6">
          <span className="text-xs font-medium text-[var(--color-primary)] font-mono">{gl.financial_row}</span>
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

// ─── CAC table ───────────────────────────────────────────────────────────────

// Fixed channel order for the CAC table (per spec)
// Labels match the Pipeline tab's CHANNEL_ORDER exactly.
const CAC_CHANNEL_ORDER = [
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
] as const;

// Channels present in SF but not tracked in NetSuite spend → CAC always "—"
const NO_COST_CHANNELS = new Set<string>(['Rep Nurture']);

// Channels whose cost is merged into another channel → show "—" for everything
const MERGED_CHANNELS = new Set<string>([]);

// Maps raw Salesforce primary_channel → display channel label (matches Pipeline tab)
const SF_TO_NETSUITE: Record<string, string> = {
  'Paid Search':       'Paid Search',
  'Web Paid':          'Paid Search',
  'Paid Social':       'Paid Social',
  'Social Media':      'Paid Social',
  'Web Organic':       'SEO / Organic',
  'SEO / Organic':     'SEO / Organic',
  'Web Direct':        'Web Direct',
  'Review Sites':      'Review Sites',
  'Trade Show':        'Trade Show',
  'Referral':          'Partner / Referral',  // both SF raw values → same display label as Pipeline
  'Partner':           'Partner / Referral',
  'Email':             'Email',
  'Sales Development': 'Sales Development',
  'Other':             'Other',
  'Web Other':         'Other',
  'Rep Nurture':       'Rep Nurture',
};


/** Format a CAC dollar value. null → "—", 0 → "$0", n → "$3,229" */
function fmtCac(cac: number | null): string {
  if (cac === null) return '—';
  return formatCurrency(cac * 100);  // cac is already in dollars; formatCurrency takes cents
}

function CacTable({
  cacData,
  view,
  loading,
  footerLabel = 'Portfolio Cohort CAC',
}: {
  cacData: CacResponse | null;
  view:    View;
  loading: boolean;
  footerLabel?: string;
}) {
  // Build period list + lookup maps (both keyed by display period label)
  const { periods, costByPeriod, oppsByPeriod } = useMemo(() => {
    if (!cacData) return { periods: [] as string[], costByPeriod: new Map<string, Map<string, number>>(), oppsByPeriod: new Map<string, Map<string, number>>() };

    // Cost by [netsuiteChannel][periodLabel]
    const costByPeriod = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    for (const r of cacData.cost_rows) {
      const ch = normalizeChannel(r.channel);
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!costByPeriod.has(ch)) costByPeriod.set(ch, new Map());
      const m = costByPeriod.get(ch)!;
      m.set(label, (m.get(label) ?? 0) + r.cost);
    }

    // Opps by [netsuiteChannel][periodLabel] — SF channels mapped first
    const oppsByPeriod = new Map<string, Map<string, number>>();

    for (const r of cacData.opp_rows) {
      const nsCh = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!oppsByPeriod.has(nsCh)) oppsByPeriod.set(nsCh, new Map());
      const m = oppsByPeriod.get(nsCh)!;
      m.set(label, (m.get(label) ?? 0) + r.opps);
    }

    return {
      periods: sortPeriods([...periodSet], view),
      costByPeriod,
      oppsByPeriod,
    };
  }, [cacData, view]);

  // One row per channel in fixed order
  const rows = useMemo(() => {
    return CAC_CHANNEL_ORDER.map((channel) => {
      const isMerged = MERGED_CHANNELS.has(channel);
      const isNoCost = NO_COST_CHANNELS.has(channel);
      const chCosts  = costByPeriod.get(channel);
      const chOpps   = oppsByPeriod.get(channel);

      if (isMerged) {
        return { channel, values: periods.map(() => null as number | null), totalCac: null as number | null, isMerged: true };
      }

      let totalCost = 0;
      let totalOpps = 0;

      const values: (number | null)[] = periods.map((p) => {
        const cost = isNoCost ? 0 : (chCosts?.get(p) ?? 0);
        const opps = chOpps?.get(p) ?? 0;
        totalCost += cost;
        totalOpps += opps;
        if (isNoCost) return null;  // cost not tracked → CAC undefined
        if (opps === 0) return null; // can't divide by zero → "—"
        return cost / opps;          // may be 0 if cost = 0 → "$0" per spec
      });

      const totalCac = isNoCost || totalOpps === 0 ? null : totalCost / totalOpps;
      return { channel, values, totalCac, isMerged: false };
    });
  }, [periods, costByPeriod, oppsByPeriod]);

  // Portfolio footer: total tracked cost / ALL won deals (including no-cost channels like Rep Nurture)
  // Cost: only channels with NS spend (trackedChannels — Rep Nurture has no cost, so it's 0 either way).
  // Won: every key in oppsByPeriod so Rep Nurture closed won deals count, matching Dashboard denominator.
  const portfolio = useMemo(() => {
    const costChannels   = CAC_CHANNEL_ORDER.filter(
      (ch) => !NO_COST_CHANNELS.has(ch) && !MERGED_CHANNELS.has(ch)
    );
    const allWonChannels = [...oppsByPeriod.keys()];

    let grandCost = 0;
    let grandOpps = 0;

    const values: (number | null)[] = periods.map((p) => {
      let pCost = 0;
      let pOpps = 0;
      for (const ch of costChannels)    pCost += costByPeriod.get(ch)?.get(p) ?? 0;
      for (const ch of allWonChannels)  pOpps += oppsByPeriod.get(ch)?.get(p) ?? 0;
      grandCost += pCost;
      grandOpps += pOpps;
      if (pOpps === 0) return null;
      return pCost / pOpps;
    });

    return {
      values,
      totalCac: grandOpps > 0 ? grandCost / grandOpps : null,
    };
  }, [periods, costByPeriod, oppsByPeriod]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (!cacData || periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
              Channel
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
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(({ channel, values, totalCac, isMerged }) => (
            <tr
              key={channel}
              className={cn(
                'bg-white',
                isMerged && 'opacity-40'
              )}
            >
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                {channel}
                {isMerged && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">(→ Referral)</span>
                )}
              </td>
              {values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                    v === null ? 'text-gray-300' : 'text-gray-800',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}
                >
                  {fmtCac(v)}
                </td>
              ))}
              <td
                className={cn(
                  'px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap',
                  totalCac === null ? 'text-gray-300' : 'text-gray-800'
                )}
              >
                {fmtCac(totalCac)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
              {footerLabel}
            </td>
            {portfolio.values.map((v, i) => (
              <td
                key={i}
                className={cn(
                  'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                  v === null && 'opacity-40'
                )}
              >
                {fmtCac(v)}
              </td>
            ))}
            <td className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', portfolio.totalCac === null && 'opacity-40')}>
              {fmtCac(portfolio.totalCac)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── ARR : CAC table ─────────────────────────────────────────────────────────

/** Format an ARR:CAC ratio. null → "—", e.g. 3.2 → "3.2x" */
function fmtRatio(r: number | null): string {
  if (r === null) return '—';
  return `${r.toFixed(1)}x`;
}

function ArrToCacTable({
  cacData,
  view,
  loading,
}: {
  cacData:  CacResponse | null;
  view:     View;
  loading:  boolean;
}) {
  const { periods, costByPeriod, arrByPeriod } = useMemo(() => {
    if (!cacData) return {
      periods: [] as string[],
      costByPeriod: new Map<string, Map<string, number>>(),
      arrByPeriod:  new Map<string, Map<string, number>>(),
    };

    const costByPeriod = new Map<string, Map<string, number>>();
    const arrByPeriod  = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    for (const r of cacData.cost_rows) {
      const ch = normalizeChannel(r.channel);
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!costByPeriod.has(ch)) costByPeriod.set(ch, new Map());
      costByPeriod.get(ch)!.set(label, (costByPeriod.get(ch)!.get(label) ?? 0) + r.cost);
    }

    for (const r of cacData.arr_rows) {
      const nsCh = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!arrByPeriod.has(nsCh)) arrByPeriod.set(nsCh, new Map());
      arrByPeriod.get(nsCh)!.set(label, (arrByPeriod.get(nsCh)!.get(label) ?? 0) + r.arr);
    }

    return { periods: sortPeriods([...periodSet], view), costByPeriod, arrByPeriod };
  }, [cacData, view]);

  const rows = useMemo(() => {
    return CAC_CHANNEL_ORDER.map((channel) => {
      const isMerged = MERGED_CHANNELS.has(channel);
      const isNoCost = NO_COST_CHANNELS.has(channel);

      if (isMerged) {
        return { channel, values: periods.map(() => null as number | null), total: null as number | null, isMerged: true };
      }

      let totalCost = 0;
      let totalArr  = 0;

      const values: (number | null)[] = periods.map((p) => {
        const cost = isNoCost ? 0 : (costByPeriod.get(channel)?.get(p) ?? 0);
        const arr  = arrByPeriod.get(channel)?.get(p) ?? 0;
        totalCost += cost;
        totalArr  += arr;
        if (isNoCost || cost === 0) return null;
        return arr / cost;
      });

      const total = isNoCost || totalCost === 0 ? null : totalArr / totalCost;
      return { channel, values, total, isMerged: false };
    });
  }, [periods, costByPeriod, arrByPeriod]);

  // Portfolio footer: total ALL ARR / total tracked cost.
  // Cost: only channels with NS spend (Rep Nurture has no cost).
  // ARR: every key in arrByPeriod (includes Rep Nurture deals) so the total
  //      matches the Dashboard "Total Closed Won ARR" row exactly.
  const portfolio = useMemo(() => {
    const costChannels  = CAC_CHANNEL_ORDER.filter(
      (ch) => !NO_COST_CHANNELS.has(ch) && !MERGED_CHANNELS.has(ch)
    );
    const allArrChannels = [...arrByPeriod.keys()];

    let grandCost = 0;
    let grandArr  = 0;
    const values: (number | null)[] = periods.map((p) => {
      let pCost = 0;
      let pArr  = 0;
      for (const ch of costChannels)   pCost += costByPeriod.get(ch)?.get(p) ?? 0;
      for (const ch of allArrChannels) pArr  += arrByPeriod.get(ch)?.get(p)  ?? 0;
      grandCost += pCost;
      grandArr  += pArr;
      return pCost === 0 ? null : pArr / pCost;
    });
    return { values, total: grandCost > 0 ? grandArr / grandCost : null };
  }, [periods, costByPeriod, arrByPeriod]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (!cacData || periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
              Channel
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
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(({ channel, values, total, isMerged }) => (
            <tr key={channel} className={cn('bg-white', isMerged && 'opacity-40')}>
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                {channel}
                {isMerged && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">(→ Referral)</span>
                )}
              </td>
              {values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                    v === null ? 'text-gray-300' : 'text-gray-800',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}
                >
                  {fmtRatio(v)}
                </td>
              ))}
              <td
                className={cn(
                  'px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap',
                  total === null ? 'text-gray-300' : 'text-gray-800'
                )}
              >
                {fmtRatio(total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
              Portfolio ARR : CAC
            </td>
            {portfolio.values.map((v, i) => (
              <td
                key={i}
                className={cn(
                  'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                  v === null && 'opacity-40'
                )}
              >
                {fmtRatio(v)}
              </td>
            ))}
            <td className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', portfolio.total === null && 'opacity-40')}>
              {fmtRatio(portfolio.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── ASP table (ARR ÷ Won Count, used in Channel – Close Date subtab) ────────

function AspTable({
  cacData,
  view,
  loading,
}: {
  cacData:  CacResponse | null;
  view:     View;
  loading:  boolean;
}) {
  const { periods, arrByPeriod, oppsByPeriod } = useMemo(() => {
    if (!cacData) return {
      periods:     [] as string[],
      arrByPeriod:  new Map<string, Map<string, number>>(),
      oppsByPeriod: new Map<string, Map<string, number>>(),
    };

    const arrByPeriod  = new Map<string, Map<string, number>>();
    const oppsByPeriod = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    for (const r of cacData.arr_rows) {
      const nsCh = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!arrByPeriod.has(nsCh)) arrByPeriod.set(nsCh, new Map());
      arrByPeriod.get(nsCh)!.set(label, (arrByPeriod.get(nsCh)!.get(label) ?? 0) + r.arr);
    }

    for (const r of cacData.opp_rows) {
      const nsCh = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!oppsByPeriod.has(nsCh)) oppsByPeriod.set(nsCh, new Map());
      oppsByPeriod.get(nsCh)!.set(label, (oppsByPeriod.get(nsCh)!.get(label) ?? 0) + r.opps);
    }

    return { periods: sortPeriods([...periodSet], view), arrByPeriod, oppsByPeriod };
  }, [cacData, view]);

  const rows = useMemo(() => {
    return CAC_CHANNEL_ORDER.map((channel) => {
      const chArr  = arrByPeriod.get(channel);
      const chOpps = oppsByPeriod.get(channel);
      let totalArr  = 0;
      let totalOpps = 0;

      const values: (number | null)[] = periods.map((p) => {
        const arr  = chArr?.get(p)  ?? 0;
        const opps = chOpps?.get(p) ?? 0;
        totalArr  += arr;
        totalOpps += opps;
        return opps === 0 ? null : arr / opps;
      });

      return { channel, values, total: totalOpps === 0 ? null : totalArr / totalOpps };
    });
  }, [periods, arrByPeriod, oppsByPeriod]);

  // Portfolio: weighted ARR / won count across all channels
  const portfolio = useMemo(() => {
    const allArrCh  = [...arrByPeriod.keys()];
    const allOppCh  = [...oppsByPeriod.keys()];
    let grandArr  = 0;
    let grandOpps = 0;
    const values: (number | null)[] = periods.map((p) => {
      let pArr = 0, pOpps = 0;
      for (const ch of allArrCh)  pArr  += arrByPeriod.get(ch)?.get(p)  ?? 0;
      for (const ch of allOppCh)  pOpps += oppsByPeriod.get(ch)?.get(p) ?? 0;
      grandArr  += pArr;
      grandOpps += pOpps;
      return pOpps === 0 ? null : pArr / pOpps;
    });
    return { values, total: grandOpps > 0 ? grandArr / grandOpps : null };
  }, [periods, arrByPeriod, oppsByPeriod]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (!cacData || periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
              Channel
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
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(({ channel, values, total }) => (
            <tr key={channel} className="bg-white hover:bg-gray-50">
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                {channel}
              </td>
              {values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                    v === null ? 'text-gray-300' : 'text-gray-800',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}
                >
                  {fmtCac(v)}
                </td>
              ))}
              <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap', total === null ? 'text-gray-300' : 'text-gray-800')}>
                {fmtCac(total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
              Portfolio ASP
            </td>
            {portfolio.values.map((v, i) => (
              <td
                key={i}
                className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', v === null && 'opacity-40')}
              >
                {fmtCac(v)}
              </td>
            ))}
            <td className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', portfolio.total === null && 'opacity-40')}>
              {fmtCac(portfolio.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── $ / Opportunity table ───────────────────────────────────────────────────

function DollarPerOppTable({
  cacData,
  view,
  loading,
}: {
  cacData:  CacResponse | null;
  view:     View;
  loading:  boolean;
}) {
  const { periods, costByPeriod, oppsByPeriod } = useMemo(() => {
    if (!cacData) return {
      periods: [] as string[],
      costByPeriod: new Map<string, Map<string, number>>(),
      oppsByPeriod: new Map<string, Map<string, number>>(),
    };

    const costByPeriod = new Map<string, Map<string, number>>();
    const oppsByPeriod = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    for (const r of cacData.cost_rows) {
      const ch = normalizeChannel(r.channel);
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!costByPeriod.has(ch)) costByPeriod.set(ch, new Map());
      const m = costByPeriod.get(ch)!;
      m.set(label, (m.get(label) ?? 0) + r.cost);
    }

    for (const r of cacData.all_opp_rows) {
      const nsCh = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!oppsByPeriod.has(nsCh)) oppsByPeriod.set(nsCh, new Map());
      const m = oppsByPeriod.get(nsCh)!;
      m.set(label, (m.get(label) ?? 0) + r.opps);
    }

    return { periods: sortPeriods([...periodSet], view), costByPeriod, oppsByPeriod };
  }, [cacData, view]);

  const rows = useMemo(() => {
    return CAC_CHANNEL_ORDER.map((channel) => {
      const isMerged = MERGED_CHANNELS.has(channel);
      const isNoCost = NO_COST_CHANNELS.has(channel);
      const chCosts  = costByPeriod.get(channel);
      const chOpps   = oppsByPeriod.get(channel);

      if (isMerged) {
        return { channel, values: periods.map(() => null as number | null), total: null as number | null, isMerged: true };
      }

      let totalCost = 0;
      let totalOpps = 0;

      const values: (number | null)[] = periods.map((p) => {
        const cost = isNoCost ? 0 : (chCosts?.get(p) ?? 0);
        const opps = chOpps?.get(p) ?? 0;
        totalCost += cost;
        totalOpps += opps;
        if (isNoCost) return null;
        if (opps === 0) return null;
        return cost / opps;
      });

      const total = isNoCost || totalOpps === 0 ? null : totalCost / totalOpps;
      return { channel, values, total, isMerged: false };
    });
  }, [periods, costByPeriod, oppsByPeriod]);

  // Portfolio footer: total tracked cost / ALL valid-channel opps per period
  // Cost uses only channels with tracked spend (excludes Rep Nurture which has no NetSuite cost).
  // Opps uses every key in oppsByPeriod (all valid primary_channel opps, including Rep Nurture)
  // so the denominator matches the Dashboard "Total Opportunities" row exactly.
  const portfolio = useMemo(() => {
    const costChannels = CAC_CHANNEL_ORDER.filter(
      (ch) => !NO_COST_CHANNELS.has(ch) && !MERGED_CHANNELS.has(ch)
    );
    const allOppChannels = [...oppsByPeriod.keys()];
    let grandCost = 0;
    let grandOpps = 0;
    const values: (number | null)[] = periods.map((p) => {
      let pCost = 0;
      let pOpps = 0;
      for (const ch of costChannels)    pCost += costByPeriod.get(ch)?.get(p) ?? 0;
      for (const ch of allOppChannels)  pOpps += oppsByPeriod.get(ch)?.get(p) ?? 0;
      grandCost += pCost;
      grandOpps += pOpps;
      return pOpps === 0 ? null : pCost / pOpps;
    });
    return { values, total: grandOpps > 0 ? grandCost / grandOpps : null };
  }, [periods, costByPeriod, oppsByPeriod]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (!cacData || periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
              Channel
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
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(({ channel, values, total, isMerged }) => (
            <tr key={channel} className={cn('bg-white', isMerged && 'opacity-40')}>
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                {channel}
                {isMerged && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">(→ Referral)</span>
                )}
              </td>
              {values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                    v === null ? 'text-gray-300' : 'text-gray-800',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}
                >
                  {fmtCac(v)}
                </td>
              ))}
              <td
                className={cn(
                  'px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap',
                  total === null ? 'text-gray-300' : 'text-gray-800'
                )}
              >
                {fmtCac(total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
              Portfolio $ / Opp
            </td>
            {portfolio.values.map((v, i) => (
              <td
                key={i}
                className={cn(
                  'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                  v === null && 'opacity-40'
                )}
              >
                {fmtCac(v)}
              </td>
            ))}
            <td className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', portfolio.total === null && 'opacity-40')}>
              {fmtCac(portfolio.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── ARR table ───────────────────────────────────────────────────────────────

function ArrTable({
  arrRows,
  view,
  loading,
}: {
  arrRows:   ArrRow[];
  view:      View;
  loading:   boolean;
}) {
  const { periods, arrByChannel } = useMemo(() => {
    const arrByChannel = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    for (const r of arrRows) {
      // Map SF channel → NetSuite display channel; blank/unknown → "Other"
      const nsCh = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!arrByChannel.has(nsCh)) arrByChannel.set(nsCh, new Map());
      const m = arrByChannel.get(nsCh)!;
      m.set(label, (m.get(label) ?? 0) + r.arr);
    }

    return { periods: sortPeriods([...periodSet], view), arrByChannel };
  }, [arrRows, view]);

  const rows = useMemo(() => {
    return CAC_CHANNEL_ORDER.map((channel) => {
      const chMap = arrByChannel.get(channel);
      const values: (number | null)[] = periods.map((p) => {
        const v = chMap?.get(p) ?? 0;
        return v === 0 ? null : v;
      });
      const total = periods.reduce((s, p) => s + (chMap?.get(p) ?? 0), 0);
      return { channel, values, total: total === 0 ? null : total };
    });
  }, [periods, arrByChannel]);

  // Total footer sums ALL channels in arrByChannel (not just CAC_CHANNEL_ORDER)
  // so it matches the Dashboard total which includes every Closed Won deal.
  const totals = useMemo(() => {
    const allChannels = [...arrByChannel.keys()];
    const perPeriod = periods.map((p) =>
      allChannels.reduce((s, ch) => s + (arrByChannel.get(ch)?.get(p) ?? 0), 0)
    );
    const grand = perPeriod.reduce((s, v) => s + v, 0);
    return { perPeriod, grand };
  }, [periods, arrByChannel]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
              Channel
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
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(({ channel, values, total }) => (
            <tr key={channel} className="bg-white hover:bg-gray-50">
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                {channel}
              </td>
              {values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                    v === null ? 'text-gray-300' : 'text-gray-800',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}
                >
                  {fmtCac(v)}
                </td>
              ))}
              <td
                className={cn(
                  'px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap',
                  total === null ? 'text-gray-300' : 'text-gray-800'
                )}
              >
                {fmtCac(total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
              Total Closed Won ARR
            </td>
            {totals.perPeriod.map((v, i) => (
              <td
                key={i}
                className={cn(
                  'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                  v === 0 && 'opacity-40'
                )}
              >
                {fmtCac(v === 0 ? null : v)}
              </td>
            ))}
            <td className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', totals.grand === 0 && 'opacity-40')}>
              {fmtCac(totals.grand === 0 ? null : totals.grand)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Payback table ───────────────────────────────────────────────────────────

/** Format a payback number: null → "—", e.g. 8.5 → "8.5" (months) */
function fmtPayback(n: number | null): string {
  if (n === null) return '—';
  return n.toFixed(1);
}

/** Format a win rate: null/0 → "—", e.g. 42.3 → "42.3%" */
function fmtWinRate(v: number | null): string {
  if (v === null || v === 0) return '—';
  return `${v.toFixed(1)}%`;
}

function PaybackTable({
  cacData,
  view,
  loading,
}: {
  cacData:  CacResponse | null;
  view:     View;
  loading:  boolean;
}) {
  const [gmInput, setGmInput] = useState('69');   // string so the input stays editable
  const gm = Math.min(100, Math.max(1, Number(gmInput) || 69)) / 100;

  const { periods, rowData, portfolioValues, portfolioTotal } = useMemo(() => {
    if (!cacData) return {
      periods:         [] as string[],
      rowData:         [] as { channel: string; values: (number | null)[]; total: number | null }[],
      portfolioValues: [] as (number | null)[],
      portfolioTotal:  null as number | null,
    };

    const costByPeriod = new Map<string, Map<string, number>>();
    const arrByPeriod  = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    for (const r of cacData.cost_rows) {
      const ch    = normalizeChannel(r.channel);
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!costByPeriod.has(ch)) costByPeriod.set(ch, new Map());
      costByPeriod.get(ch)!.set(label, (costByPeriod.get(ch)!.get(label) ?? 0) + r.cost);
    }

    for (const r of cacData.arr_rows) {
      const nsCh  = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!arrByPeriod.has(nsCh)) arrByPeriod.set(nsCh, new Map());
      arrByPeriod.get(nsCh)!.set(label, (arrByPeriod.get(nsCh)!.get(label) ?? 0) + r.arr);
    }

    const periods = sortPeriods([...periodSet], view);

    // Per-channel: Payback = CAC ÷ (ASP / 12 × GM%)
    //   = (cost/won) ÷ ((arr/won) / 12 × gm)
    //   = cost × 12 ÷ (arr × gm)     ← won-count cancels
    const rowData = CAC_CHANNEL_ORDER.map((channel) => {
      const isMerged = MERGED_CHANNELS.has(channel);
      const isNoCost = NO_COST_CHANNELS.has(channel);

      if (isMerged) {
        return { channel, values: periods.map(() => null as number | null), total: null as number | null };
      }

      let totalCost = 0, totalArr = 0;

      const values: (number | null)[] = periods.map((p) => {
        const cost = isNoCost ? 0 : (costByPeriod.get(channel)?.get(p) ?? 0);
        const arr  = arrByPeriod.get(channel)?.get(p) ?? 0;
        totalCost += cost;
        totalArr  += arr;
        if (isNoCost || arr === 0) return null;
        return cost * 12 / (arr * gm);
      });

      const total = isNoCost || totalArr === 0 ? null : totalCost * 12 / (totalArr * gm);
      return { channel, values, total };
    });

    // Portfolio: same formula, aggregated across all tracked-cost channels
    const costChannels   = CAC_CHANNEL_ORDER.filter(ch => !NO_COST_CHANNELS.has(ch) && !MERGED_CHANNELS.has(ch));
    const allArrChannels = [...arrByPeriod.keys()];
    let grandCost = 0, grandArr = 0;

    const portfolioValues: (number | null)[] = periods.map((p) => {
      let pCost = 0, pArr = 0;
      for (const ch of costChannels)   pCost += costByPeriod.get(ch)?.get(p) ?? 0;
      for (const ch of allArrChannels) pArr  += arrByPeriod.get(ch)?.get(p)  ?? 0;
      grandCost += pCost;
      grandArr  += pArr;
      return pArr === 0 ? null : pCost * 12 / (pArr * gm);
    });

    const portfolioTotal = grandArr === 0 ? null : grandCost * 12 / (grandArr * gm);

    return { periods, rowData, portfolioValues, portfolioTotal };
  }, [cacData, view, gm]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (!cacData || periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* GM% assumption control */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-gray-500">Gross Margin Assumption</span>
        <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1">
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={gmInput}
            onChange={(e) => setGmInput(e.target.value)}
            onBlur={(e) => {
              const v = Math.min(100, Math.max(1, Number(e.target.value) || 69));
              setGmInput(String(v));
            }}
            className="w-10 bg-transparent text-right text-xs tabular-nums outline-none"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-800 text-white">
              <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
                Channel
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
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rowData.map(({ channel, values, total }) => (
              <tr key={channel} className="bg-white hover:bg-gray-50">
                <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                  {channel}
                </td>
                {values.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                      v === null ? 'text-gray-300' : 'text-gray-800',
                      i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                    )}
                  >
                    {fmtPayback(v)}
                  </td>
                ))}
                <td className={cn(
                  'px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap',
                  total === null ? 'text-gray-300' : 'text-gray-800'
                )}>
                  {fmtPayback(total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--color-primary)] text-white">
              <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
                Portfolio Payback
              </td>
              {portfolioValues.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                    v === null && 'opacity-40'
                  )}
                >
                  {fmtPayback(v)}
                </td>
              ))}
              <td className={cn(
                'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                portfolioTotal === null && 'opacity-40'
              )}>
                {fmtPayback(portfolioTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function WinRateTable({
  cacData,
  view,
  loading,
}: {
  cacData:  CacResponse | null;
  view:     View;
  loading:  boolean;
}) {
  const { periods, rowData, portfolioValues, portfolioTotal } = useMemo(() => {
    if (!cacData) return {
      periods:         [] as string[],
      rowData:         [] as { channel: string; values: (number | null)[]; total: number | null }[],
      portfolioValues: [] as (number | null)[],
      portfolioTotal:  null as number | null,
    };

    const wonByPeriod  = new Map<string, Map<string, number>>();
    const oppsByPeriod = new Map<string, Map<string, number>>();
    const periodSet    = new Set<string>();

    // opp_rows = Closed Won, created_month cohort
    for (const r of cacData.opp_rows) {
      const nsCh  = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!wonByPeriod.has(nsCh)) wonByPeriod.set(nsCh, new Map());
      wonByPeriod.get(nsCh)!.set(label, (wonByPeriod.get(nsCh)!.get(label) ?? 0) + r.opps);
    }

    // all_opp_rows = all opportunities, created_month cohort
    for (const r of cacData.all_opp_rows) {
      const nsCh  = SF_TO_NETSUITE[r.sf_channel] ?? 'Other';
      const label = monthKeyToPeriod(r.month_key, view);
      periodSet.add(label);
      if (!oppsByPeriod.has(nsCh)) oppsByPeriod.set(nsCh, new Map());
      oppsByPeriod.get(nsCh)!.set(label, (oppsByPeriod.get(nsCh)!.get(label) ?? 0) + r.opps);
    }

    const periods = sortPeriods([...periodSet], view);

    const rowData = CAC_CHANNEL_ORDER.map((channel) => {
      const isMerged = MERGED_CHANNELS.has(channel);
      if (isMerged) {
        return { channel, values: periods.map(() => null as number | null), total: null as number | null };
      }

      let totalWon = 0, totalOpps = 0;
      const values: (number | null)[] = periods.map((p) => {
        const won  = wonByPeriod.get(channel)?.get(p)  ?? 0;
        const opps = oppsByPeriod.get(channel)?.get(p) ?? 0;
        totalWon  += won;
        totalOpps += opps;
        if (opps === 0) return null;
        return (won / opps) * 100;
      });

      const total = totalOpps === 0 ? null : (totalWon / totalOpps) * 100;
      return { channel, values, total };
    });

    // Portfolio: total won / total opps across all channels
    const allWonCh  = [...wonByPeriod.keys()];
    const allOppsCh = [...oppsByPeriod.keys()];
    let grandWon = 0, grandOpps = 0;

    const portfolioValues: (number | null)[] = periods.map((p) => {
      let pWon = 0, pOpps = 0;
      for (const ch of allWonCh)  pWon  += wonByPeriod.get(ch)?.get(p)  ?? 0;
      for (const ch of allOppsCh) pOpps += oppsByPeriod.get(ch)?.get(p) ?? 0;
      grandWon  += pWon;
      grandOpps += pOpps;
      return pOpps === 0 ? null : (pWon / pOpps) * 100;
    });

    const portfolioTotal = grandOpps === 0 ? null : (grandWon / grandOpps) * 100;

    return { periods, rowData, portfolioValues, portfolioTotal };
  }, [cacData, view]);

  const latestIdx = periods.length - 1;
  const scrollRef = useAutoScrollRight([periods]);

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: CAC_CHANNEL_ORDER.length }).map((_, i) => (
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
    );
  }

  if (!cacData || periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">
        No data for the selected filters.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-800 text-white">
            <th className="sticky left-0 z-30 bg-gray-800 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide min-w-[220px]">
              Channel
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
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rowData.map(({ channel, values, total }) => (
            <tr key={channel} className="bg-white hover:bg-gray-50">
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-800">
                {channel}
              </td>
              {values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-4 py-2.5 text-right tabular-nums whitespace-nowrap',
                    v === null ? 'text-gray-300' : 'text-gray-800',
                    i === latestIdx && 'bg-[var(--color-chart-budget)]/[0.15]'
                  )}
                >
                  {fmtWinRate(v)}
                </td>
              ))}
              <td className={cn(
                'px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap',
                total === null ? 'text-gray-300' : 'text-gray-800'
              )}>
                {fmtWinRate(total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-primary)] text-white">
            <td className="sticky left-0 z-10 bg-[var(--color-primary)] px-4 py-3 text-left font-bold text-sm">
              Portfolio Win Rate
            </td>
            {portfolioValues.map((v, i) => (
              <td
                key={i}
                className={cn(
                  'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
                  v === null && 'opacity-40'
                )}
              >
                {fmtWinRate(v)}
              </td>
            ))}
            <td className={cn(
              'px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap',
              portfolioTotal === null && 'opacity-40'
            )}>
              {fmtWinRate(portfolioTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ChannelCostsClient() {
  const [channel,     setChannel]     = useState('all');
  const [view,        setView]        = useState<View>('quarterly');
  const [periodType,  setPeriodType]  = useState<PeriodType>('transaction');
  const [preset,      setPreset]      = useState<Preset>('12m');
  const [from,        setFrom]        = useState('');
  const [to,          setTo]          = useState('');
  const [months,      setMonths]      = useState<string[]>([]);
  const [nsLatest,    setNsLatest]    = useState<string>('');
  const [monthsLoading, setMonthsLoading] = useState(false);
  const [data,        setData]        = useState<ChannelDetailResponse | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [cacData,      setCacData]      = useState<CacResponse | null>(null);
  const [loadingCac,   setLoadingCac]   = useState(true);
  const [activeSubtab, setActiveSubtab] = useState<Subtab>('cohort');
  const [cacDataCd,    setCacDataCd]    = useState<CacResponse | null>(null);
  const [loadingCacCd, setLoadingCacCd] = useState(true);
  const initialized = useRef(false);
  const isQoQ = preset === 'qoq';

  // ── Fetch months list when period type changes ────────────────────────────
  useEffect(() => {
    setMonthsLoading(true);
    initialized.current = false; // re-init range when period type changes
    fetch(`/api/channel-costs/months?period_type=${periodType}`)
      .then((r) => r.json())
      .then((j) => {
        setMonths(j.months ?? []);
        if (j.ns_latest) setNsLatest(j.ns_latest);
      })
      .catch(() => {})
      .finally(() => setMonthsLoading(false));
  }, [periodType]);

  // ── Init date range once months load (default: last 12 months) ───────────
  // Anchors "to" on the actual NS latest month so preset ranges reflect real data.
  useEffect(() => {
    if (months.length === 0 || initialized.current) return;
    initialized.current = true;
    // Use ns_latest as the "to" anchor so Last 12M always ends at the last month
    // with actual NS spend data (not a Salesforce-only month from the union).
    const anchor  = nsLatest || months[0];
    const earliest = months[months.length - 1];
    const f = addMonthsHelper(anchor, -11);
    const rawFrom = f < earliest ? earliest : f;
    setTo(snapTo(anchor, view));
    setFrom(snapFrom(rawFrom, view));
    setPreset('12m');
  }, [months, nsLatest]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Preset handler ────────────────────────────────────────────────────────
  const applyPreset = useCallback((p: Preset) => {
    if (months.length === 0) return;
    // Anchor to actual NS latest for spend-based presets; fall back to months[0]
    // only if ns_latest is not yet available.
    const anchor  = nsLatest || months[0];
    const earliest = months[months.length - 1];
    setPreset(p);

    let newFrom: string;
    const newTo = anchor;
    let newView = view;

    if (p === 'qoq') {
      newView = 'quarterly';
      setView('quarterly');
      const f = addMonthsHelper(anchor, -14);
      newFrom = f < earliest ? earliest : f;
    } else if (p === 'all') {
      newFrom = earliest;
    } else {
      const delta = p === '6m' ? -5 : p === '12m' ? -11 : -23;
      const f = addMonthsHelper(anchor, delta);
      newFrom = f < earliest ? earliest : f;
    }

    setFrom(snapFrom(newFrom, newView));
    setTo(snapTo(newTo, newView));
  }, [months, nsLatest, view]);

  // ── View change: snap from/to to new period boundaries ───────────────────
  const handleViewChange = (v: View) => {
    if (isQoQ && v !== 'quarterly') return;
    setView(v);
    if (from) setFrom(snapFrom(from, v));
    if (to)   setTo(snapTo(to, v));
  };

  // ── Data fetches ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async (ch: string, f: string, t: string, pt: PeriodType) => {
    if (!f || !t) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: f, to: t, period_type: pt });
      if (ch !== 'all') params.set('channel', ch);
      const res  = await fetch(`/api/channel-costs?${params}`);
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
    if (from && to) fetchData(channel, from, to, periodType);
  }, [fetchData, channel, from, to, periodType]);

  const fetchCac = useCallback(async (f: string, t: string, pt: PeriodType) => {
    if (!f || !t) return;
    setLoadingCac(true);
    try {
      const params = new URLSearchParams({ from: f, to: t, period_type: pt });
      const res  = await fetch(`/api/channel-costs/cac?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load CAC');
      setCacData(json);
    } catch (e) {
      console.error('[ChannelCosts/CAC]', e);
    } finally {
      setLoadingCac(false);
    }
  }, []);

  useEffect(() => {
    if (from && to) fetchCac(from, to, periodType);
  }, [fetchCac, from, to, periodType]);

  const fetchCacCd = useCallback(async (f: string, t: string, pt: PeriodType) => {
    if (!f || !t) return;
    setLoadingCacCd(true);
    try {
      const params = new URLSearchParams({ from: f, to: t, period_type: pt, date_type: 'close_date' });
      const res  = await fetch(`/api/channel-costs/cac?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load CAC close-date');
      setCacDataCd(json);
    } catch (e) {
      console.error('[ChannelCosts/CACcd]', e);
    } finally {
      setLoadingCacCd(false);
    }
  }, []);

  useEffect(() => {
    if (from && to) fetchCacCd(from, to, periodType);
  }, [fetchCacCd, from, to, periodType]);

  const handlePeriodTypeChange = (pt: PeriodType) => setPeriodType(pt);

  const exportCsv = useCallback(() => {
    if (!data || data.rows.length === 0) return;
    const periodSet = new Set<string>();
    data.rows.forEach((r) => periodSet.add(monthKeyToPeriod(r.month_key, view)));
    const periods = sortPeriods([...periodSet], view);

    const isAll = channel === 'all';
    const headerCols = isAll
      ? ['Channel', 'GL Account', 'Vendor', ...periods, 'Total']
      : ['GL Account', 'Vendor', ...periods, 'Total'];

    const matrix = new Map<string, Map<string, number>>();
    for (const r of data.rows) {
      const key = isAll
        ? `${r.channel}|||${r.financial_row}|||${r.entity_name}`
        : `${r.financial_row}|||${r.entity_name}`;
      if (!matrix.has(key)) matrix.set(key, new Map());
      const period = monthKeyToPeriod(r.month_key, view);
      matrix.get(key)!.set(period, (matrix.get(key)!.get(period) ?? 0) + r.amount);
    }

    const lines: string[] = [];
    for (const [key, pm] of matrix) {
      const parts  = key.split('|||');
      const values = periods.map((p) => pm.get(p) ?? 0);
      const total  = values.reduce((s, v) => s + v, 0);
      lines.push([...parts.map((p) => `"${p}"`), ...values.map(String), String(total)].join(','));
    }

    const csv  = [headerCols.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `channel-economics-${channel}-${view}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, channel, view, from, to]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
        Channel Economics
      </h1>

      {/* ── Subtab nav ──────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <SubtabBar active={activeSubtab} onChange={setActiveSubtab} />
        <p className="text-xs italic" style={{ color: '#94a3b8' }}>
          {activeSubtab === 'cohort'
            ? 'Spend and pipeline metrics grouped by the month the opportunity was created.'
            : 'Closed Won deals and ARR grouped by the month the deal was closed.'}
        </p>
      </div>

      {/* ── Unified filter bar (Pipeline style) ───────────────────────────── */}
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

        {/* Preset pills */}
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

        {/* From / To — adapts to active view */}
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

        <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Period type toggle + tooltip */}
        <div className="flex items-center gap-1.5">
          <ToggleGroup<PeriodType>
            options={[
              { label: PERIOD_LABELS.transaction, value: 'transaction' },
              { label: PERIOD_LABELS.accounting,  value: 'accounting'  },
            ]}
            value={periodType}
            onChange={handlePeriodTypeChange}
          />
          <span
            title={PERIOD_TOOLTIPS[periodType]}
            style={{ fontSize: 13, color: '#cbd5e1', cursor: 'help', userSelect: 'none', lineHeight: 1 }}
            aria-label="Period type explanation"
          >
            ⓘ
          </span>
        </div>

        <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Channel */}
        <LightSelect value={channel} onChange={setChannel}>
          <option value="all">All Channels</option>
          {CHANNEL_ORDER.map((ch) => (
            <option key={ch} value={ch}>{ch}</option>
          ))}
        </LightSelect>

        <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Export */}
        <button
          onClick={exportCsv}
          disabled={!data || data.rows.length === 0}
          className="transition-colors"
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            background: 'transparent',
            color: 'var(--color-neutral)',
            border: '1px solid #e2e8f0',
            borderRadius: 9999,
            cursor: (!data || data.rows.length === 0) ? 'not-allowed' : 'pointer',
            opacity: (!data || data.rows.length === 0) ? 0.4 : 1,
          }}
        >
          Export CSV
        </button>
      </div>

      {activeSubtab === 'cohort' && (<>
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
            <AllChannelsView rows={data.rows} view={view} />
          ) : (
            <PivotTable rows={data.rows} view={view} />
          )
        )}
      </>)}

      {/* ── Channel Cohort metric sections ────────────────────────────────── */}
      {activeSubtab === 'cohort' && (<>

        {/* ── Closed Won ARR section ──────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              Total Closed Won ARR by Channel ($)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <ArrTable
            arrRows={cacData?.arr_rows ?? []}
            view={view}
            loading={loadingCac}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>ARR = Monthly MRR × 12 for Closed Won deals, grouped by the month the opportunity was created (cohort view)</p>
          </div>
        </div>

        {/* ── $ / Opportunity section ─────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              $ / Opportunity by Channel
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <DollarPerOppTable
            cacData={cacData}
            view={view}
            loading={loadingCac}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>$ / Opp = Channel Cost ÷ Total Opportunities created (all stages), grouped by creation cohort</p>
            <p>Rep Nurture cost not tracked in NetSuite — opportunities shown only</p>
          </div>
        </div>

        {/* ── Cohort CAC section ──────────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              Cohort CAC ($ per Cohort Won Deal)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <CacTable
            cacData={cacData}
            view={view}
            loading={loadingCac}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>CAC = Channel Cost ÷ Closed Won deals per channel</p>
            <p>Rep Nurture cost not tracked in NetSuite — opportunities shown only</p>
          </div>
        </div>

        {/* ── ARR : CAC section ───────────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              ARR : CAC by Channel (higher = better)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <ArrToCacTable
            cacData={cacData}
            view={view}
            loading={loadingCac}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>ARR : CAC = Closed Won ARR ÷ Channel Cost — measures how much ARR is generated per dollar spent</p>
            <p>Rep Nurture cost not tracked in NetSuite — ratio not available</p>
          </div>
        </div>

        {/* ── Cohort Win Rate section ─────────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              Cohort Win Rate (Won ÷ Opportunities)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <WinRateTable
            cacData={cacData}
            view={view}
            loading={loadingCac}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>Win Rate = Closed Won deals ÷ Total Opportunities created, grouped by creation cohort</p>
            <p>Measures what fraction of created opportunities eventually close as won</p>
          </div>
        </div>
      </>)}

      {/* ── Channel – Close Date metric sections ──────────────────────────── */}
      {activeSubtab === 'closedate' && (<>

        {/* TABLE 1 — Channel Cost (same NetSuite spend as Channel Cohort) ──── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              Channel Cost
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

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
          {!loading && data && (
            data.rows.length === 0 ? (
              <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-gray-400">
                No data for the selected filters.
              </div>
            ) : channel === 'all' ? (
              <AllChannelsView rows={data.rows} view={view} allinSmRows={cacDataCd?.total_sm_rows ?? []} />
            ) : (
              <PivotTable rows={data.rows} view={view} allinSmRows={cacDataCd?.total_sm_rows ?? []} />
            )
          )}

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>NetSuite S&amp;M spend by channel — same calculation as Channel Cohort tab</p>
          </div>
        </div>

        {/* TABLE 2 — Closed Won ARR ($) — close_date based ─────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              Closed Won ARR ($)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <ArrTable
            arrRows={cacDataCd?.arr_rows ?? []}
            view={view}
            loading={loadingCacCd}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>ARR = Monthly MRR × 12 for Closed Won deals, grouped by close date</p>
          </div>
        </div>

        {/* TABLE 3 — $ / Opportunity — same as Channel Cohort (created_month) ─ */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              $ / Opportunity (Cost ÷ Opportunities)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <DollarPerOppTable
            cacData={cacData}
            view={view}
            loading={loadingCac}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>$ / Opp = Channel Cost ÷ Total Opportunities created (all stages, creation cohort) — same as Channel Cohort</p>
            <p>Rep Nurture cost not tracked in NetSuite — opportunities shown only</p>
          </div>
        </div>

        {/* TABLE 4 — CAC ($ per Won Deal) — close_date based ─────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              CAC ($ per Won Deal)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <CacTable
            cacData={cacDataCd}
            view={view}
            loading={loadingCacCd}
            footerLabel="Portfolio Close-Date CAC"
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>CAC = Channel Cost ÷ Closed Won deals per channel, SF deals grouped by close date</p>
            <p>Rep Nurture cost not tracked in NetSuite — opportunities shown only</p>
          </div>
        </div>

        {/* TABLE 5 — ARR : CAC (higher = better) — close_date based ──────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              ARR : CAC (ARR ÷ Cost — higher = better)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <ArrToCacTable
            cacData={cacDataCd}
            view={view}
            loading={loadingCacCd}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>ARR : CAC = Closed Won ARR ÷ Channel Cost, SF deals grouped by close date</p>
            <p>Rep Nurture cost not tracked in NetSuite — ratio not available</p>
          </div>
        </div>

        {/* TABLE 6 — Payback (Months) — CAC ÷ (ASP/12 × GM) ─────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <h2 className="shrink-0 text-sm font-bold uppercase tracking-wide text-gray-700">
              Payback (Months) — CAC ÷ (ASP/12 × GM)
            </h2>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <PaybackTable
            cacData={cacDataCd}
            view={view}
            loading={loadingCacCd}
          />

          <div className="space-y-0.5 text-xs text-gray-400">
            <p>Payback = CAC ÷ (ASP / 12 × GM%) — SF deals grouped by close date</p>
            <p>CAC = channel cost ÷ won deals · ASP = channel ARR ÷ won deals · GM% = gross margin assumption (adjustable above)</p>
            <p>Rep Nurture cost not tracked in NetSuite — payback not available</p>
          </div>
        </div>
      </>)}
    </div>
  );
}
