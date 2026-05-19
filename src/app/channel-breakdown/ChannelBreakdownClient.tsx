'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { formatCurrency } from '@/lib/format';
import type { SpendResponse } from '@/app/api/channel-breakdown/spend/route';
import { cn } from '@/lib/cn';

type View = 'monthly' | 'quarterly' | 'yearly';

// Fixed channel display order; channels not in this list appear after in alphabetical order
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

interface DisplayRow {
  channel: string;
  values: number[];
  total: number;
  isSubtotal?: boolean;
}

const colHelper = createColumnHelper<DisplayRow>();

function fmt(n: number) {
  return n === 0 ? '—' : formatCurrency(n * 100);
}

export default function ChannelBreakdownClient() {
  const [view, setView] = useState<View>('quarterly');
  const [year, setYear] = useState<string>('all');
  const [data, setData] = useState<SpendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (v: View, y: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: v });
      if (y !== 'all') params.set('year', y);
      const res = await fetch(`/api/channel-breakdown/spend?${params}`);
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
    fetchData(view, year);
  }, [fetchData, view, year]);

  const { sortedRows, latestPeriodIdx } = useMemo((): { sortedRows: DisplayRow[]; latestPeriodIdx: number } => {
    if (!data) return { sortedRows: [], latestPeriodIdx: -1 };

    const sorted = [...data.rows].sort((a, b) => {
      const ai = CHANNEL_ORDER.indexOf(a.channel);
      const bi = CHANNEL_ORDER.indexOf(b.channel);
      if (ai === -1 && bi === -1) return a.channel.localeCompare(b.channel);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const subtotalRow: DisplayRow = {
      channel: 'Subtotal — Direct Channel Spend',
      values: data.subtotal,
      total: data.grand_total,
      isSubtotal: true,
    };

    return {
      sortedRows: [...sorted, subtotalRow],
      latestPeriodIdx: data.periods.length - 1,
    };
  }, [data]);

  // Rebuild columns whenever periods change
  const columns = useMemo<ColumnDef<DisplayRow>[]>(() => {
    if (!data) return [];
    const cols: ColumnDef<DisplayRow>[] = [
      colHelper.accessor('channel', {
        header: 'Channel',
        cell: (info) => {
          const row = info.row.original;
          return (
            <span className={cn('text-sm', row.isSubtotal && 'font-semibold')}>
              {info.getValue()}
            </span>
          );
        },
      }) as ColumnDef<DisplayRow>,
    ];

    data.periods.forEach((period, i) => {
      cols.push(
        colHelper.display({
          id: `period-${i}`,
          header: period,
          cell: ({ row }) => {
            const val = row.original.values[i] ?? 0;
            return (
              <span className={cn('tabular-nums text-sm', val === 0 && 'text-gray-300', row.original.isSubtotal && 'font-semibold')}>
                {fmt(val)}
              </span>
            );
          },
        }) as ColumnDef<DisplayRow>
      );
    });

    cols.push(
      colHelper.accessor('total', {
        header: 'Total',
        cell: (info) => {
          const row = info.row.original;
          const val = info.getValue();
          return (
            <span className={cn('tabular-nums text-sm font-medium', val === 0 && 'text-gray-300', row.isSubtotal && 'font-semibold')}>
              {fmt(val)}
            </span>
          );
        },
      }) as ColumnDef<DisplayRow>
    );

    return cols;
  }, [data]);

  const table = useReactTable({
    data: sortedRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Period column indices (offset +1 for channel col)
  const periodCount = data?.periods.length ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Channel Spend</h1>

        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-sm">
            {(['monthly', 'quarterly', 'yearly'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'px-4 py-2 capitalize transition-colors',
                  view === v
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {/* Year filter */}
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          >
            <option value="all">All Years</option>
            {(data?.years ?? []).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-gray-50 border-b border-gray-200">
                {hg.headers.map((h, hi) => (
                  <th
                    key={h.id}
                    className={cn(
                      'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500',
                      hi === 0 ? 'text-left' : 'text-right',
                      // highlight latest period column (period cols start at index 1, end before Total)
                      hi > 0 && hi === latestPeriodIdx + 1 && 'bg-blue-50'
                    )}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* Section header row */}
            {!loading && (
              <tr>
                <td
                  colSpan={1 + periodCount + 1}
                  className="bg-[var(--color-primary)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-white"
                >
                  A. Direct Channel Spend (Marketing-tagged GL)
                </td>
              </tr>
            )}

            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: Math.max(3, periodCount + 2) }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row, ri) => {
                  const isSubtotal = row.original.isSubtotal;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        isSubtotal
                          ? 'bg-gray-50 border-t-2 border-gray-300'
                          : ri % 2 === 0
                          ? 'bg-white hover:bg-gray-50'
                          : 'bg-gray-50/50 hover:bg-gray-50'
                      )}
                    >
                      {row.getVisibleCells().map((cell, ci) => (
                        <td
                          key={cell.id}
                          className={cn(
                            'px-4 py-2.5',
                            ci === 0 ? 'text-left' : 'text-right',
                            // highlight latest period column
                            ci > 0 && ci === latestPeriodIdx + 1 && !isSubtotal && 'bg-blue-50/60',
                            ci > 0 && ci === latestPeriodIdx + 1 && isSubtotal && 'bg-blue-50'
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="space-y-1 text-xs text-gray-400">
        <p>Excludes Do Not Tag (COGS/Non-S&M) and Unclassified vendors.</p>
        <p>
          <Link href="/vendor-classifications" className="text-[var(--color-primary)] hover:underline">
            → Classify vendors
          </Link>
        </p>
      </div>
    </div>
  );
}
