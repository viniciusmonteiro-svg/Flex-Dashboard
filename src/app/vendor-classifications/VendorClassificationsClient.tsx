'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { formatCurrency } from '@/lib/format';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';
import { PAIR_CLASSIFICATIONS } from '@/lib/vendorPresets';

const CHANNELS = [
  'Paid Search',
  'Paid Social',
  'Programmatic',
  'Email Marketing',
  'SEO',
  'Content Marketing',
  'Events & Sponsorships',
  'PR & Communications',
  'Marketing Technology',
  'Agency & Creative Services',
  'Video & OTT',
  'Affiliate & Partnerships',
  'Out of Home',
  'Podcast & Audio',
  'Influencer Marketing',
  'Do Not Tag (COGS/Non-S&M)',
  'Unclassified',
] as const;

type Channel = (typeof CHANNELS)[number];

// Stable composite key for a row
function rowKey(r: Pick<VendorClassificationRow, 'financial_row' | 'entity_name'>) {
  return `${r.financial_row}||${r.entity_name}`;
}

const colHelper = createColumnHelper<VendorClassificationRow>();

export default function VendorClassificationsClient() {
  const [rows, setRows] = useState<VendorClassificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/vendor-classifications');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setRows(data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyPresets = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch('/api/vendor-classifications/apply-presets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to apply presets');
      await fetchRows();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [fetchRows]);

  const autoApplied = useRef(false);
  useEffect(() => {
    if (autoApplied.current) return;
    autoApplied.current = true;
    (async () => {
      await fetch('/api/vendor-classifications/apply-presets', { method: 'POST' });
      await fetchRows();
    })();
  }, [fetchRows]);

  const handleChannelChange = useCallback(
    async (row: VendorClassificationRow, channel: string) => {
      const key = rowKey(row);
      setSaving(key);
      try {
        const res = await fetch('/api/vendor-classifications/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            financial_row: row.financial_row,
            entity_name: row.entity_name,
            channel,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');
        setRows((prev) =>
          prev.map((r) =>
            rowKey(r) === key ? { ...r, channel, manually_set: true } : r
          )
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(null);
      }
    },
    []
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (filterChannel !== 'all') {
      out = out.filter((r) => r.channel === filterChannel);
    }
    if (filterText.trim()) {
      const lower = filterText.trim().toLowerCase();
      out = out.filter(
        (r) =>
          r.entity_name.toLowerCase().includes(lower) ||
          r.financial_row.toLowerCase().includes(lower)
      );
    }
    return out;
  }, [rows, filterChannel, filterText]);

  const summary = useMemo(() => {
    const total = rows.length;
    const classified = rows.filter((r) => r.channel !== 'Unclassified').length;
    const manual = rows.filter((r) => r.manually_set).length;
    const unclassified = rows.filter((r) => r.channel === 'Unclassified').length;
    const pct = total > 0 ? Math.round((classified / total) * 100) : 0;
    return { total, classified, manual, unclassified, pct };
  }, [rows]);

  const columns = useMemo(
    () => [
      colHelper.display({
        id: 'vendor',
        header: 'Vendor / Entity',
        cell: ({ row }) => {
          const { entity_name, financial_row } = row.original;
          return (
            <div>
              <span className="font-mono text-xs text-gray-900">{entity_name}</span>
              {financial_row && (
                <div className="mt-0.5 font-mono text-[11px] text-gray-400 truncate max-w-xs">
                  {financial_row}
                </div>
              )}
            </div>
          );
        },
      }),
      colHelper.accessor('channel', {
        header: 'Channel',
        cell: (info) => {
          const orig = info.row.original;
          const key = rowKey(orig);
          const current = info.getValue() as Channel;
          const isSaving = saving === key;
          return (
            <select
              value={current}
              disabled={isSaving}
              onChange={(e) => handleChannelChange(orig, e.target.value)}
              className="rounded border border-[var(--color-neutral)] bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          );
        },
      }),
      colHelper.accessor('total_amount', {
        header: 'Total Spend',
        cell: (info) => formatCurrency(info.getValue() * 100),
      }),
      colHelper.accessor('months_active', {
        header: 'Months',
        cell: (info) => info.getValue(),
      }),
      colHelper.display({
        id: 'source',
        header: 'Source',
        cell: (info) => {
          const { manually_set, is_preset, financial_row, entity_name } = info.row.original;
          if (manually_set) return <Badge color="blue">Manual</Badge>;
          const inMap = !!PAIR_CLASSIFICATIONS[`${financial_row}|${entity_name}`];
          if (is_preset || inMap) return <Badge color="green">Preset</Badge>;
          return <Badge color="gray">—</Badge>;
        },
      }),
    ],
    [handleChannelChange, saving]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Vendor Classification</h1>
        <button
          onClick={applyPresets}
          disabled={applying || loading}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Re-apply Presets'}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Total Vendors" value={summary.total} />
        <StatCard label="Classified" value={summary.classified} />
        <StatCard label="Unclassified" value={summary.unclassified} highlight={summary.unclassified > 0} />
        <StatCard label="Manual" value={summary.manual} />
        <StatCard label="Coverage" value={`${summary.pct}%`} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search vendor or GL row…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] w-64"
        />
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        >
          <option value="all">All Channels</option>
          {CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {ch}
            </option>
          ))}
        </select>
        <span className="self-center text-sm text-gray-500">
          {filtered.length} of {rows.length} vendors
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="cursor-pointer select-none px-4 py-3 hover:text-gray-700"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc' && ' ↑'}
                    {h.column.getIsSorted() === 'desc' && ' ↓'}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400">
                  No vendors found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          highlight ? 'text-[var(--color-warning)]' : 'text-gray-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: 'blue' | 'green' | 'gray';
}) {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    gray: 'bg-gray-50 text-gray-400 border-gray-200',
  }[color];
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}
