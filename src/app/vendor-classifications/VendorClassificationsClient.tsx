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
import { formatCurrency, formatDateTime, formatMonthShort } from '@/lib/format';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';
import { PAIR_CLASSIFICATIONS } from '@/lib/vendorPresets';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import { PreviewModal, type PendingChange } from '@/components/ui/PreviewModal';
import { useUnsavedChanges } from '@/lib/UnsavedChangesContext';

const CHANNELS = [
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
  'Do Not Tag (COGS/Non-S&M)',
  'Unclassified',
] as const;

type Channel = (typeof CHANNELS)[number];

function rowKey(r: Pick<VendorClassificationRow, 'financial_row' | 'entity_name'>) {
  return `${r.financial_row}||${r.entity_name}`;
}

const colHelper = createColumnHelper<VendorClassificationRow>();

export default function VendorClassificationsClient() {
  const [rows, setRows] = useState<VendorClassificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  // Month selector state
  const [selectedMonth, setSelectedMonth] = useState<string>('current');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);

  // Pending changes
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const hasPending = pendingChanges.size > 0;
  const isHistoryMode = selectedMonth !== 'current';

  // Register unsaved-changes guard for tab navigation
  const { register, unregister } = useUnsavedChanges();
  const pendingRef = useRef(pendingChanges);
  pendingRef.current = pendingChanges;

  useEffect(() => {
    register(() => pendingRef.current.size > 0);
    return () => unregister();
  }, [register, unregister]);

  const addToast = useCallback((message: string, type: ToastItem['type']) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Unsaved changes guard — browser close/refresh
  useEffect(() => {
    if (!hasPending) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasPending]);

  // Fetch available months from netsuite data
  useEffect(() => {
    fetch('/api/vendor-classifications/months')
      .then((r) => r.json())
      .then((d) => { if (d.months) setAvailableMonths(d.months); })
      .catch(() => {/* non-fatal */});
  }, []);

  const fetchRows = useCallback(async (monthKey: string | null = null, isSwitching = false) => {
    if (isSwitching) setMonthLoading(true);
    else setLoading(true);
    setError(null);
    try {
      const url = monthKey
        ? `/api/vendor-classifications?month_key=${monthKey}`
        : '/api/vendor-classifications';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setRows(data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setMonthLoading(false);
    }
  }, []);

  // Auto-apply presets on first mount (current mode only)
  const autoApplied = useRef(false);
  useEffect(() => {
    if (autoApplied.current) return;
    autoApplied.current = true;
    (async () => {
      await fetch('/api/vendor-classifications/apply-presets', { method: 'POST' });
      await fetchRows(null);
    })();
  }, [fetchRows]);

  // Refetch when selectedMonth changes; also discard any pending changes
  const prevMonth = useRef(selectedMonth);
  useEffect(() => {
    if (prevMonth.current === selectedMonth) return;
    prevMonth.current = selectedMonth;
    setPendingChanges(new Map());
    fetchRows(selectedMonth === 'current' ? null : selectedMonth, true);
  }, [selectedMonth, fetchRows]);

  const applyPresets = useCallback(async () => {
    if (hasPending) {
      const ok = window.confirm(
        `You have ${pendingChanges.size} unsaved change(s). Applying presets will discard them. Continue?`
      );
      if (!ok) return;
      setPendingChanges(new Map());
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch('/api/vendor-classifications/apply-presets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to apply presets');
      await fetchRows(null);
      if (isHistoryMode) setSelectedMonth('current');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [fetchRows, hasPending, pendingChanges.size, isHistoryMode]);

  const handleChannelChange = useCallback(
    (row: VendorClassificationRow, newChannel: string) => {
      const key = rowKey(row);
      setPendingChanges((prev) => {
        const next = new Map(prev);
        const existing = prev.get(key);
        const oldChannel = existing ? existing.old_channel : row.channel;
        if (newChannel === oldChannel) {
          next.delete(key);
        } else {
          next.set(key, {
            financial_row: row.financial_row,
            entity_name: row.entity_name,
            old_channel: oldChannel,
            new_channel: newChannel,
            // History mode → tag with the specific month so the save
            // targets only that period; Current mode → no month_key means "all months"
            month_key: isHistoryMode ? selectedMonth : undefined,
          });
        }
        return next;
      });
      // Optimistic UI update
      setRows((prev) =>
        prev.map((r) => (rowKey(r) === key ? { ...r, channel: newChannel } : r))
      );
    },
    [isHistoryMode, selectedMonth]
  );

  const handleSaveAll = useCallback(async () => {
    if (pendingChanges.size === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      // Each change carries its own month_key (set at edit time in handleChannelChange).
      // Current-mode changes have no month_key → batch-upsert updates all months.
      // History-mode changes carry the specific month_key → only that month is updated.
      const changes = Array.from(pendingChanges.values()).map((c) => ({
        financial_row: c.financial_row,
        entity_name: c.entity_name,
        channel: c.new_channel,
        ...(c.month_key ? { month_key: c.month_key } : {}),
      }));

      const res = await fetch('/api/vendor-classifications/batch-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPendingChanges(new Map());
      setPreviewOpen(false);
      addToast(`✓ ${data.saved} classification${data.saved !== 1 ? 's' : ''} saved`, 'success');
      await fetchRows(isHistoryMode ? selectedMonth : null);
    } catch (e) {
      setError((e as Error).message);
      addToast('Save failed — please retry', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, fetchRows, addToast, isHistoryMode, selectedMonth]);

  const handleDiscard = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => {
        const key = rowKey(r);
        const pending = pendingChanges.get(key);
        return pending ? { ...r, channel: pending.old_channel } : r;
      })
    );
    setPendingChanges(new Map());
    addToast('Changes discarded', 'info');
  }, [pendingChanges, addToast]);

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
          const isPending = pendingChanges.has(key);
          // Show calendar icon when in history mode and this month's classification
          // differs from the current (canonical) classification
          const differsFromCurrent =
            isHistoryMode && orig.channel !== orig.current_channel;
          return (
            <div className="flex items-center gap-2">
              <select
                value={current}
                disabled={isSaving}
                onChange={(e) => handleChannelChange(orig, e.target.value)}
                className="rounded border border-[var(--color-neutral)] bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
              >
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
              {isPending && (
                <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  unsaved
                </span>
              )}
              {differsFromCurrent && !isPending && (
                <span
                  title={`This month: ${orig.channel} | Current (all-time): ${orig.current_channel}`}
                  className="cursor-help text-base leading-none opacity-70"
                  aria-label="Differs from current classification"
                >
                  📅
                </span>
              )}
            </div>
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
      // Last Modified — only meaningful in current mode
      colHelper.accessor('updated_at', {
        header: 'Last Modified',
        cell: (info) => {
          const { manually_set } = info.row.original;
          const ts = info.getValue();
          if (isHistoryMode || !manually_set || !ts) {
            return <span className="text-gray-300">—</span>;
          }
          return (
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {formatDateTime(ts)}
            </span>
          );
        },
        sortingFn: (a, b) => {
          const ta = a.original.updated_at ?? '';
          const tb = b.original.updated_at ?? '';
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        },
      }),
    ],
    [handleChannelChange, isSaving, pendingChanges, isHistoryMode]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const pendingArray = useMemo(() => Array.from(pendingChanges.values()), [pendingChanges]);

  // Human-readable label for the selected month banner
  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === 'current') return '';
    const [y, m] = selectedMonth.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [selectedMonth]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Vendor Classification</h1>
        <button
          onClick={applyPresets}
          disabled={applying || loading || isHistoryMode}
          title={isHistoryMode ? 'Switch to Current view to apply presets' : undefined}
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

      {/* ── History mode banner ── */}
      {isHistoryMode && (
        <div className="flex items-center justify-between rounded-md border border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_8%,white)] px-4 py-2.5">
          <p className="text-sm font-medium text-[var(--color-primary)]">
            Viewing {selectedMonthLabel} classifications. Changes will only affect this month.
          </p>
          <button
            onClick={() => setSelectedMonth('current')}
            className="ml-4 rounded text-xs font-medium text-[var(--color-primary)] underline hover:opacity-70"
          >
            Back to Current
          </button>
        </div>
      )}

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Total Vendors" value={summary.total} />
        <StatCard label="Classified" value={summary.classified} />
        <StatCard label="Unclassified" value={summary.unclassified} highlight={summary.unclassified > 0} />
        <StatCard label="Manual" value={summary.manual} />
        <StatCard label="Coverage" value={`${summary.pct}%`} />
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Month selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Viewing:</span>
          <div className="relative">
            <select
              value={selectedMonth}
              disabled={monthLoading}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-md border border-[var(--color-neutral)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-60"
            >
              <option value="current">Current</option>
              {availableMonths.map((mk) => (
                <option key={mk} value={mk}>{formatMonthShort(mk)}</option>
              ))}
            </select>
            {monthLoading && (
              <span className="pointer-events-none absolute inset-y-0 right-6 flex items-center">
                <svg className="h-3.5 w-3.5 animate-spin text-[var(--color-primary)]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </span>
            )}
          </div>
        </div>

        <div className="h-5 w-px bg-gray-200" />

        <input
          type="text"
          placeholder="Search vendor or GL row…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] w-56"
        />
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        >
          <option value="all">All Channels</option>
          {CHANNELS.map((ch) => (
            <option key={ch} value={ch}>{ch}</option>
          ))}
        </select>
        <span className="self-center text-sm text-gray-500">
          {filtered.length} of {rows.length} vendors
        </span>
      </div>

      {/* ── Table ── */}
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
              table.getRowModel().rows.map((row) => {
                const key = rowKey(row.original);
                const isPending = pendingChanges.has(key);
                return (
                  <tr
                    key={row.id}
                    className={
                      isPending
                        ? 'border-l-[3px] border-l-[var(--color-pending)] bg-[var(--color-pending-bg)]'
                        : 'hover:bg-gray-50'
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Sticky save bar ── */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] transition-transform duration-300 ${
          hasPending ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {pendingChanges.size} unsaved change{pendingChanges.size !== 1 ? 's' : ''}
            {isHistoryMode && (
              <span className="ml-2 text-xs text-gray-400">
                — will save to {selectedMonthLabel} only
              </span>
            )}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPreviewOpen(true)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Preview Changes
            </button>
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save All Changes'}
            </button>
            <button
              onClick={handleDiscard}
              disabled={isSaving}
              className="text-sm text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      </div>

      {/* ── Preview modal ── */}
      <PreviewModal
        open={previewOpen}
        changes={pendingArray}
        onConfirm={handleSaveAll}
        onCancel={() => setPreviewOpen(false)}
      />

      {/* ── Toasts ── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
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
