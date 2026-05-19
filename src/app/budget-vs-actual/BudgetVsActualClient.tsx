'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { KpiCard } from '@/components/ui/KpiCard';
import { MonthSelector } from '@/components/ui/MonthSelector';
import { VarianceBridgeChart } from '@/components/dashboard/VarianceBridgeChart';
import { BudgetTrendChart } from '@/components/dashboard/BudgetTrendChart';
import { formatCurrency, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';

// ── Types ────────────────────────────────────────────────────────────────────

interface SummaryRow {
  channel: string;
  budget: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

interface Totals {
  budget: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

interface TrendRow {
  month_key: string;
  budget: number;
  actual: number;
  variance: number;
}

// ── Flag logic ───────────────────────────────────────────────────────────────

function flag(variance_pct: number): string {
  if (variance_pct > 10) return '🔴';
  if (variance_pct > 0) return '🟡';
  return '🟢';
}

// ── Column definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<SummaryRow>[] = [
  {
    accessorKey: 'channel',
    header: 'Channel',
    cell: (info) => <span className="font-medium">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: 'budget',
    header: 'Budget',
    cell: (info) => formatCurrency(info.getValue<number>()),
  },
  {
    accessorKey: 'actual',
    header: 'Actual',
    cell: (info) => formatCurrency(info.getValue<number>()),
  },
  {
    accessorKey: 'variance',
    header: 'Variance',
    cell: (info) => {
      const v = info.getValue<number>();
      return (
        <span className={v > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}>
          {formatCurrency(v)}
        </span>
      );
    },
  },
  {
    accessorKey: 'variance_pct',
    header: 'Variance %',
    cell: (info) => {
      const v = info.getValue<number>();
      const sign = v > 0 ? '+' : '';
      return (
        <span className={v > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}>
          {sign}{formatPercent(v)}
        </span>
      );
    },
  },
  {
    id: 'flag',
    header: 'Flag',
    accessorFn: (row) => row.variance_pct,
    cell: (info) => flag(info.getValue<number>()),
    enableSorting: true,
  },
];

// ── Main component ───────────────────────────────────────────────────────────

export function BudgetVsActualClient() {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  // Fetch available months on mount
  useEffect(() => {
    setLoadingMonths(true);
    fetch('/api/budget-vs-actual/months')
      .then((r) => r.json())
      .then((data: { months: string[] }) => {
        setMonths(data.months ?? []);
        if (data.months?.length) setSelectedMonth(data.months[0]);
      })
      .finally(() => setLoadingMonths(false));
  }, []);

  // Fetch summary whenever month changes
  useEffect(() => {
    if (!selectedMonth) return;
    setLoadingSummary(true);
    fetch(`/api/budget-vs-actual/summary?month=${selectedMonth}`)
      .then((r) => r.json())
      .then((data: { rows: SummaryRow[]; totals: Totals | null }) => {
        setSummaryRows(data.rows ?? []);
        setTotals(data.totals ?? null);
      })
      .finally(() => setLoadingSummary(false));
  }, [selectedMonth]);

  // Fetch trend whenever month changes (using all channels)
  useEffect(() => {
    setLoadingTrend(true);
    fetch('/api/budget-vs-actual/trend?channel=all')
      .then((r) => r.json())
      .then((data: { rows: TrendRow[] }) => {
        setTrendRows(data.rows ?? []);
      })
      .finally(() => setLoadingTrend(false));
  }, [selectedMonth]);

  const bridgeData = useMemo(
    () => summaryRows.map((r) => ({ channel: r.channel, variance: r.variance })),
    [summaryRows]
  );

  const table = useReactTable({
    data: summaryRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (loadingMonths) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--color-neutral)]">
        Loading…
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--color-neutral)]">
        No data found. Run <code className="mx-1 font-mono">npm run ingest</code> to load data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-primary)]">Budget vs Actual</h1>
        <MonthSelector
          months={months}
          selected={selectedMonth}
          onChange={setSelectedMonth}
        />
      </div>

      {/* KPI row */}
      {loadingSummary ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : totals ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard label="Total Budget" value={formatCurrency(totals.budget)} />
          <KpiCard label="Total Actual" value={formatCurrency(totals.actual)} />
          <KpiCard
            label="Total Variance"
            value={formatCurrency(totals.variance)}
            invertDelta={false}
          />
          <KpiCard
            label="Variance %"
            value={`${totals.variance_pct > 0 ? '+' : ''}${formatPercent(totals.variance_pct)}`}
            delta={parseFloat(totals.variance_pct.toFixed(1))}
            deltaLabel={totals.variance_pct > 0 ? 'over budget' : 'under budget'}
            invertDelta={true}
          />
        </div>
      ) : null}

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Variance bridge */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-primary)]">
            Variance by Channel
          </h2>
          {loadingSummary ? (
            <div className="h-48 animate-pulse rounded bg-gray-100" />
          ) : (
            <VarianceBridgeChart data={bridgeData} />
          )}
        </div>

        {/* Trend */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-primary)]">
            Budget vs Actual — Last 12 Months
          </h2>
          {loadingTrend ? (
            <div className="h-48 animate-pulse rounded bg-gray-100" />
          ) : (
            <BudgetTrendChart data={trendRows} />
          )}
        </div>
      </div>

      {/* Summary table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-primary)]">
            Channel Detail
          </h2>
        </div>
        {loadingSummary ? (
          <div className="h-48 animate-pulse rounded-b-lg bg-gray-50" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-band)] text-xs font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        className={cn(
                          'px-5 py-3 text-left',
                          header.column.getCanSort() && 'cursor-pointer select-none hover:text-[var(--color-primary)]'
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && ' ↑'}
                        {header.column.getIsSorted() === 'desc' && ' ↓'}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-gray-100">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-band)]">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-5 py-3 text-[var(--color-primary)]">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                {summaryRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-5 py-8 text-center text-[var(--color-neutral)]">
                      No data for this month
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
