'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatMonthShort } from '@/lib/format';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import { useUnsavedChanges } from '@/lib/UnsavedChangesContext';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';

const DEPARTMENTS = [
  'Administration',
  'Development',
  'Implementation',
  'Information',
  'Marketing',
  'Support',
  'Technology',
] as const;

interface Allocation {
  id:               number;
  financial_row:    string;
  entity_name:      string;
  marketing_pct:    number;
  other_department: string;
  other_pct:        number;
  valid_from:       string | null;
  valid_to:         string | null;
  description:      string | null;
}

interface IcDisplayRow extends VendorClassificationRow {
  marketing_pct:    number;     // 100 = no split
  other_department: string;
  other_pct:        number;
  valid_from:       string | null;
  valid_to:         string | null;
  ic_description:   string | null;
  alloc_id:         number | null;
  orig_valid_from:  string | null;  // for deletion key
}

interface IcPendingChange {
  financial_row:    string;
  entity_name:      string;
  old_marketing_pct: number;
  new_marketing_pct: number;
  other_department: string;
  other_pct:        number;
  valid_from:       string | null;
  valid_to:         string | null;
  description:      string | null;
  old_valid_from:   string | null;
}

const rowKey = (r: { financial_row: string; entity_name: string }) =>
  `${r.financial_row}||${r.entity_name}`;

export default function IntercompanyTab() {
  const [rows, setRows]           = useState<IcDisplayRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [pendingChanges, setPendingChanges] = useState<Map<string, IcPendingChange>>(new Map());
  const [isSaving, setIsSaving]   = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toasts, setToasts]       = useState<ToastItem[]>([]);

  const [months, setMonths]               = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [filterText, setFilterText]       = useState('');
  const [showSplitOnly, setShowSplitOnly] = useState(false);

  const hasPending = pendingChanges.size > 0;

  // Register unsaved-changes guard
  const { register, unregister } = useUnsavedChanges();
  const pendingRef = useRef(pendingChanges);
  pendingRef.current = pendingChanges;
  useEffect(() => {
    register(() => pendingRef.current.size > 0);
    return () => unregister();
  }, [register, unregister]);

  useEffect(() => {
    if (!hasPending) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [hasPending]);

  const addToast = useCallback((msg: string, type: ToastItem['type']) => {
    const id = crypto.randomUUID();
    setToasts((p) => [...p, { id, message: msg, type }]);
  }, []);
  const dismissToast = useCallback((id: string) =>
    setToasts((p) => p.filter((t) => t.id !== id)), []);

  useEffect(() => {
    fetch('/api/vendor-classifications/months?period_type=accounting')
      .then((r) => r.json())
      .then((d) => { if (d.months) setMonths(d.months); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period_type: 'accounting' });
      if (selectedMonth !== 'all') params.set('month_key', selectedMonth);
      const [vcRes, icRes] = await Promise.all([
        fetch(`/api/vendor-classifications?${params}`),
        fetch('/api/intercompany'),
      ]);
      const vcData = await vcRes.json();
      const icData = await icRes.json();

      const allocations: Allocation[] = icData.allocations ?? [];

      const findAlloc = (financial_row: string, entity_name: string): Allocation | null => {
        const candidates = allocations.filter(
          (a) => a.financial_row === financial_row && a.entity_name === entity_name
        );
        if (selectedMonth !== 'all') {
          // active in selected month
          const active = candidates.filter(
            (a) =>
              (a.valid_from === null || a.valid_from <= selectedMonth) &&
              (a.valid_to   === null || a.valid_to   >= selectedMonth)
          );
          if (active.length > 0) {
            return active.find((a) => a.valid_from === null) ?? active[0];
          }
        }
        return candidates.find((a) => a.valid_from === null) ?? candidates[0] ?? null;
      };

      const merged: IcDisplayRow[] = (vcData.rows as VendorClassificationRow[])
        .map((vc) => {
          const alloc = findAlloc(vc.financial_row, vc.entity_name);
          return {
            ...vc,
            marketing_pct:   alloc?.marketing_pct    ?? 100,
            other_department: alloc?.other_department ?? '',
            other_pct:        alloc?.other_pct        ?? 0,
            valid_from:       alloc?.valid_from        ?? null,
            valid_to:         alloc?.valid_to          ?? null,
            ic_description:   alloc?.description       ?? null,
            alloc_id:         alloc?.id                ?? null,
            orig_valid_from:  alloc?.valid_from        ?? null,
          };
        })
        .sort((a, b) => b.total_amount - a.total_amount);

      setRows(merged);
    } catch {
      addToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleRowChange = useCallback((
    row: IcDisplayRow,
    patch: Partial<Pick<IcPendingChange, 'new_marketing_pct' | 'other_department' | 'valid_from' | 'valid_to' | 'description'>>
  ) => {
    const key = rowKey(row);
    setPendingChanges((prev) => {
      const next    = new Map(prev);
      const current = prev.get(key);
      const baseRow: IcPendingChange = current ?? {
        financial_row:     row.financial_row,
        entity_name:       row.entity_name,
        old_marketing_pct: row.marketing_pct,
        new_marketing_pct: row.marketing_pct,
        other_department:  row.other_department,
        other_pct:         parseFloat((100 - row.marketing_pct).toFixed(2)),
        valid_from:        row.valid_from,
        valid_to:          row.valid_to,
        description:       row.ic_description,
        old_valid_from:    row.orig_valid_from,
      };

      const updated: IcPendingChange = { ...baseRow };
      if (patch.new_marketing_pct !== undefined) {
        updated.new_marketing_pct = patch.new_marketing_pct;
        updated.other_pct = parseFloat((100 - patch.new_marketing_pct).toFixed(2));
      }
      if (patch.other_department !== undefined) updated.other_department = patch.other_department;
      if (patch.valid_from !== undefined) updated.valid_from = patch.valid_from;
      if (patch.valid_to   !== undefined) updated.valid_to   = patch.valid_to;
      if (patch.description !== undefined) updated.description = patch.description;

      const isUnchanged =
        updated.new_marketing_pct === updated.old_marketing_pct &&
        updated.valid_from === row.orig_valid_from &&
        updated.valid_to === row.valid_to &&
        updated.other_department === row.other_department;

      if (isUnchanged) {
        next.delete(key);
      } else {
        next.set(key, updated);
      }
      return next;
    });

    // Optimistic update
    setRows((prev) =>
      prev.map((r) => {
        if (rowKey(r) !== key) return r;
        const newMkt  = patch.new_marketing_pct ?? r.marketing_pct;
        const newDept = patch.other_department  ?? r.other_department;
        return {
          ...r,
          marketing_pct:    newMkt,
          other_department: newDept,
          other_pct:        parseFloat((100 - newMkt).toFixed(2)),
          valid_from:       patch.valid_from ?? r.valid_from,
          valid_to:         patch.valid_to   ?? r.valid_to,
          ic_description:   patch.description ?? r.ic_description,
        };
      })
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!pendingChanges.size) return;
    setIsSaving(true);
    try {
      const changes = Array.from(pendingChanges.values()).map((c) => ({
        financial_row:    c.financial_row,
        entity_name:      c.entity_name,
        old_valid_from:   c.old_valid_from,
        marketing_pct:    c.new_marketing_pct,
        other_department: c.other_department,
        other_pct:        c.other_pct,
        valid_from:       c.valid_from,
        valid_to:         c.valid_to,
        description:      c.description,
        delete:           c.new_marketing_pct >= 100,
      }));
      const res = await fetch('/api/intercompany/batch-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPendingChanges(new Map());
      setPreviewOpen(false);
      addToast(`✓ ${data.saved} allocation${data.saved !== 1 ? 's' : ''} updated`, 'success');
      await load();
    } catch {
      addToast('Save failed — please retry', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, load, addToast]);

  const handleDiscard = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => {
        const p = pendingChanges.get(rowKey(r));
        if (!p) return r;
        return {
          ...r,
          marketing_pct:    p.old_marketing_pct,
          other_pct:        parseFloat((100 - p.old_marketing_pct).toFixed(2)),
          other_department: p.old_marketing_pct >= 100 ? '' : r.other_department,
          valid_from:       p.old_valid_from,
        };
      })
    );
    setPendingChanges(new Map());
    addToast('Changes discarded', 'info');
  }, [pendingChanges, addToast]);

  const summary = useMemo(() => {
    const total          = rows.length;
    const withSplit      = rows.filter((r) => r.marketing_pct < 100).length;
    const fullyMarketing = total - withSplit;
    const splitAmount    = rows
      .filter((r) => r.marketing_pct < 100)
      .reduce((s, r) => s + r.total_amount * (r.other_pct / 100), 0);
    return { total, withSplit, fullyMarketing, splitAmount };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      out = out.filter(
        (r) =>
          r.entity_name.toLowerCase().includes(q) ||
          r.financial_row.toLowerCase().includes(q)
      );
    }
    if (showSplitOnly) {
      out = out.filter((r) => r.marketing_pct < 100 || pendingChanges.has(rowKey(r)));
    }
    return out;
  }, [rows, filterText, showSplitOnly, pendingChanges]);

  const pendingArray = useMemo(() => Array.from(pendingChanges.values()), [pendingChanges]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">

      {/* ── Header ── */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Intercompany</h2>
        <p className="mt-1 text-sm text-gray-500">
          Split a vendor's GL cost between marketing and another department by percentage.
        </p>
      </div>

      {/* ── Summary ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Total Vendors', summary.total],
          ['With Split', summary.withSplit],
          ['Fully Marketing', summary.fullyMarketing],
          ['Split Away from Mkt', formatCurrency(summary.splitAmount * 100)],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Period:</span>
          <select
            value={selectedMonth}
            onChange={(e) => { setSelectedMonth(e.target.value); setPendingChanges(new Map()); }}
            className="rounded-md border border-[var(--color-neutral)] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          >
            <option value="all">All Months</option>
            {months.map((m) => <option key={m} value={m}>{formatMonthShort(m)}</option>)}
          </select>
        </div>
        <div className="h-5 w-px bg-gray-200" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search vendor or GL account…"
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] w-64"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSplitOnly}
            onChange={(e) => setShowSplitOnly(e.target.checked)}
            className="rounded"
          />
          Show split vendors only
        </label>
        <span className="ml-auto text-sm text-gray-500">
          {filtered.length} of {rows.length} vendors
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Vendor / Entity</th>
              <th className="px-4 py-3">Total Spend</th>
              <th className="px-4 py-3">Months</th>
              <th className="px-4 py-3">Marketing %</th>
              <th className="px-4 py-3">Other Department</th>
              <th className="px-4 py-3">Other %</th>
              <th className="px-4 py-3">Valid From</th>
              <th className="px-4 py-3">Valid To</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {[0,1,2,3,4,5,6,7].map((j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No vendors found</td>
              </tr>
            ) : (
              filtered.map((row) => {
                const key       = rowKey(row);
                const isPending = pendingChanges.has(key);
                const isSplit   = row.marketing_pct < 100;

                return (
                  <tr
                    key={key}
                    className={
                      isPending
                        ? 'border-l-[3px] border-l-[var(--color-pending)] bg-[var(--color-pending-bg)]'
                        : 'hover:bg-gray-50'
                    }
                  >
                    {/* Vendor */}
                    <td className="px-4 py-2.5">
                      {!row.has_name ? (
                        <div>
                          <span className="text-xs text-gray-900">-Unassigned-</span>
                          {row.financial_row && (
                            <div className="mt-0.5 font-mono text-[11px] text-gray-400 truncate max-w-xs">{row.financial_row}</div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span className="font-mono text-xs text-gray-900">{row.entity_name}</span>
                          {row.financial_row && (
                            <div className="mt-0.5 font-mono text-[11px] text-gray-400 truncate max-w-xs">{row.financial_row}</div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Total Spend */}
                    <td className="px-4 py-2.5 tabular-nums text-gray-700">
                      {formatCurrency(row.total_amount * 100)}
                    </td>

                    {/* Months */}
                    <td className="px-4 py-2.5 tabular-nums text-gray-500">{row.months_active}</td>

                    {/* Marketing % */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={row.marketing_pct}
                          disabled={isSaving}
                          onChange={(e) => {
                            const v = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                            handleRowChange(row, { new_marketing_pct: v });
                          }}
                          className="w-20 rounded border border-[var(--color-neutral)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
                        />
                        <span className="text-xs tabular-nums text-gray-500 whitespace-nowrap">
                          {formatCurrency(row.total_amount * row.marketing_pct)}
                        </span>
                        {isPending && (
                          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            unsaved
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Other Department */}
                    <td className="px-4 py-2.5">
                      {isSplit ? (
                        <select
                          value={row.other_department || DEPARTMENTS[0]}
                          disabled={isSaving}
                          onChange={(e) => handleRowChange(row, { other_department: e.target.value })}
                          className="rounded border border-[var(--color-neutral)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
                        >
                          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Other % */}
                    <td className="px-4 py-2.5 tabular-nums text-xs text-gray-600">
                      {isSplit ? `${row.other_pct.toFixed(1)}%` : '—'}
                    </td>

                    {/* Valid From */}
                    <td className="px-4 py-2.5">
                      {isSplit ? (
                        <input
                          type="month"
                          value={row.valid_from ?? ''}
                          disabled={isSaving}
                          onChange={(e) => handleRowChange(row, { valid_from: e.target.value || null })}
                          className="rounded border border-[var(--color-neutral)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Valid To */}
                    <td className="px-4 py-2.5">
                      {isSplit ? (
                        <input
                          type="month"
                          value={row.valid_to ?? ''}
                          disabled={isSaving}
                          onChange={(e) => handleRowChange(row, { valid_to: e.target.value || null })}
                          className="rounded border border-[var(--color-neutral)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
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
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPreviewOpen(true)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Preview Changes
            </button>
            <button
              onClick={handleSave}
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
      {previewOpen && (
        <dialog
          open
          className="fixed inset-0 z-50 m-auto w-full max-w-3xl rounded-lg border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-black/40"
        >
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Preview Changes</h2>
            <p className="text-sm text-gray-500 mt-1">
              {pendingArray.length} allocation{pendingArray.length !== 1 ? 's' : ''} to save
            </p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="pb-2 pr-3">Vendor</th>
                  <th className="pb-2 pr-3">GL Account</th>
                  <th className="pb-2 pr-3">Mkt %</th>
                  <th className="pb-2 pr-3">Other Dept</th>
                  <th className="pb-2 pr-3">Other %</th>
                  <th className="pb-2">Valid From→To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingArray.map((c) => (
                  <tr key={`${c.financial_row}||${c.entity_name}`}>
                    <td className="py-2 pr-3 font-mono text-xs">{c.entity_name}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-gray-500 max-w-[130px] truncate">{c.financial_row}</td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{c.new_marketing_pct.toFixed(1)}%</td>
                    <td className="py-2 pr-3">{c.new_marketing_pct >= 100 ? <span className="text-gray-400">—</span> : c.other_department}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.new_marketing_pct >= 100 ? '—' : `${c.other_pct.toFixed(1)}%`}</td>
                    <td className="py-2 text-xs text-gray-500">
                      {c.valid_from ? formatMonthShort(c.valid_from) : '—'} → {c.valid_to ? formatMonthShort(c.valid_to) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              onClick={() => setPreviewOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Confirm &amp; Save
            </button>
          </div>
        </dialog>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
