'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatMonthShort } from '@/lib/format';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import { useUnsavedChanges } from '@/lib/UnsavedChangesContext';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';

const DEPARTMENTS = [
  '(Keep in Marketing)',
  'Sales',
  'Technology',
  'Development',
  'Administration',
  'Finance',
  'Other',
] as const;

type DeptOption = (typeof DEPARTMENTS)[number];

interface GlDisplayRow extends VendorClassificationRow {
  to_department: string;    // '' = keep in marketing
  reclass_description: string | null;
}

interface GlPendingChange {
  financial_row: string;
  entity_name:   string;
  old_dept:      string;
  new_dept:      string;
  month_key:     string | null;
  from_channel:  string;
}

const rowKey = (r: { financial_row: string; entity_name: string }) =>
  `${r.financial_row}||${r.entity_name}`;

export default function GLReclassificationTab() {
  const [rows, setRows]           = useState<GlDisplayRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [pendingChanges, setPendingChanges] = useState<Map<string, GlPendingChange>>(new Map());
  const [isSaving, setIsSaving]   = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toasts, setToasts]       = useState<ToastItem[]>([]);

  const [months, setMonths]               = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [filterText, setFilterText]       = useState('');
  const [filterDept, setFilterDept]       = useState<string>('all');
  const [showReclassOnly, setShowReclassOnly] = useState(false);

  const hasPending = pendingChanges.size > 0;

  // Register unsaved-changes guard
  const { register, unregister } = useUnsavedChanges();
  const pendingRef = useRef(pendingChanges);
  pendingRef.current = pendingChanges;
  useEffect(() => {
    register(() => pendingRef.current.size > 0);
    return () => unregister();
  }, [register, unregister]);

  // Browser close guard
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

  // Load months
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
      const [vcRes, glRes] = await Promise.all([
        fetch(`/api/vendor-classifications?${params}`),
        fetch('/api/gl-reclassifications'),
      ]);
      const vcData = await vcRes.json();
      const glData = await glRes.json();

      // Build lookup: (financial_row||entity_name||month_key) → reclass row
      type RRow = { financial_row: string; entity_name: string; month_key: string | null; to_department: string; description: string | null };
      const glMap = new Map<string, RRow>();
      for (const r of (glData.reclassifications as RRow[])) {
        if (!r.entity_name) continue; // skip legacy all-entity entries (entity_name='')
        const mk = r.month_key ?? 'null';
        glMap.set(`${r.financial_row}||${r.entity_name}||${mk}`, r);
      }

      const getReclass = (financial_row: string, entity_name: string): RRow | null => {
        if (selectedMonth !== 'all') {
          const specific = glMap.get(`${financial_row}||${entity_name}||${selectedMonth}`);
          if (specific) return specific;
        }
        return glMap.get(`${financial_row}||${entity_name}||null`) ?? null;
      };

      const merged: GlDisplayRow[] = (vcData.rows as VendorClassificationRow[]).map((vc) => {
        const reclass = getReclass(vc.financial_row, vc.entity_name);
        return {
          ...vc,
          to_department:       reclass?.to_department    ?? '',
          reclass_description: reclass?.description      ?? null,
        };
      }).sort((a, b) => b.total_amount - a.total_amount);

      setRows(merged);
    } catch {
      addToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleDeptChange = useCallback((row: GlDisplayRow, newDept: string) => {
    const key = rowKey(row);
    setPendingChanges((prev) => {
      const next = new Map(prev);
      const existing = prev.get(key);
      const oldDept  = existing ? existing.old_dept : row.to_department;
      if (newDept === oldDept) {
        next.delete(key);
      } else {
        next.set(key, {
          financial_row: row.financial_row,
          entity_name:   row.entity_name,
          old_dept:      oldDept,
          new_dept:      newDept,
          month_key:     selectedMonth !== 'all' ? selectedMonth : null,
          from_channel:  row.channel,
        });
      }
      return next;
    });
    setRows((prev) =>
      prev.map((r) => rowKey(r) === key ? { ...r, to_department: newDept } : r)
    );
  }, [selectedMonth]);

  const handleSave = useCallback(async () => {
    if (!pendingChanges.size) return;
    setIsSaving(true);
    try {
      const changes = Array.from(pendingChanges.values()).map((c) => ({
        financial_row: c.financial_row,
        entity_name:   c.entity_name,
        month_key:     c.month_key,
        to_department: c.new_dept === '(Keep in Marketing)' ? '' : c.new_dept,
        from_channel:  c.from_channel,
        description:   null,
      }));
      const res = await fetch('/api/gl-reclassifications/batch-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPendingChanges(new Map());
      setPreviewOpen(false);
      addToast(`✓ ${data.saved} reclassification${data.saved !== 1 ? 's' : ''} updated`, 'success');
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
        return p ? { ...r, to_department: p.old_dept } : r;
      })
    );
    setPendingChanges(new Map());
    addToast('Changes discarded', 'info');
  }, [pendingChanges, addToast]);

  const summary = useMemo(() => {
    const total        = rows.length;
    const reclassified = rows.filter((r) => r.to_department !== '').length;
    const pct          = total > 0 ? Math.round((reclassified / total) * 100) : 0;
    return { total, reclassified, notReclassified: total - reclassified, pct };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      out = out.filter(
        (r) =>
          r.financial_row.toLowerCase().includes(q) ||
          r.entity_name.toLowerCase().includes(q)
      );
    }
    if (filterDept !== 'all') {
      if (filterDept === 'none') out = out.filter((r) => !r.to_department);
      else                        out = out.filter((r) => r.to_department === filterDept);
    }
    if (showReclassOnly) {
      out = out.filter((r) => r.to_department !== '' || pendingChanges.has(rowKey(r)));
    }
    return out;
  }, [rows, filterText, filterDept, showReclassOnly, pendingChanges]);

  const pendingArray = useMemo(() => Array.from(pendingChanges.values()), [pendingChanges]);

  const labelDept = (dept: string) => dept === '' ? '(Keep in Marketing)' : dept;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">G&L Reclassification</h2>
          <p className="mt-1 text-sm text-gray-500">
            Reclassify GL accounts away from marketing spend. Reclassified amounts are excluded from all channel cost calculations.
          </p>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {([
          ['Total Vendors', summary.total, false],
          ['Reclassified', summary.reclassified, false],
          ['Not Reclassified', summary.notReclassified, false],
          ['Coverage', `${summary.pct}%`, false],
        ] as [string, string|number, boolean][]).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
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
            {months.map((m) => (
              <option key={m} value={m}>{formatMonthShort(m)}</option>
            ))}
          </select>
        </div>
        <div className="h-5 w-px bg-gray-200" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search vendor or GL row…"
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] w-56"
        />
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="rounded-md border border-[var(--color-neutral)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        >
          <option value="all">All Departments</option>
          <option value="none">Not Reclassified</option>
          {DEPARTMENTS.slice(1).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showReclassOnly}
            onChange={(e) => setShowReclassOnly(e.target.checked)}
            className="rounded"
          />
          Show reclassified only
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
              <th className="px-4 py-3">Reclassify To</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {[0, 1, 2, 3, 4].map((j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No vendors found
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const key       = rowKey(row);
                const isPending = pendingChanges.has(key);

                return (
                  <tr
                    key={key}
                    className={
                      isPending
                        ? 'border-l-[3px] border-l-[var(--color-pending)] bg-[var(--color-pending-bg)]'
                        : 'hover:bg-gray-50'
                    }
                  >
                    {/* Vendor / Entity */}
                    <td className="px-4 py-2.5">
                      {!row.has_name ? (
                        <div>
                          <span className="text-xs text-gray-900">-Unassigned-</span>
                          {row.financial_row && (
                            <div className="mt-0.5 font-mono text-[11px] text-gray-400 truncate max-w-xs">
                              {row.financial_row}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span className="font-mono text-xs text-gray-900">{row.entity_name}</span>
                          {row.financial_row && (
                            <div className="mt-0.5 font-mono text-[11px] text-gray-400 truncate max-w-xs">
                              {row.financial_row}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Total Spend */}
                    <td className="px-4 py-2.5 tabular-nums text-gray-700">
                      {formatCurrency(row.total_amount * 100)}
                    </td>

                    {/* Months Active */}
                    <td className="px-4 py-2.5 tabular-nums text-gray-500">
                      {row.months_active}
                    </td>

                    {/* Reclassify To dropdown */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={row.to_department === '' ? '(Keep in Marketing)' : row.to_department}
                          disabled={isSaving}
                          onChange={(e) => handleDeptChange(row, e.target.value === '(Keep in Marketing)' ? '' : e.target.value)}
                          className={[
                            'rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50',
                            row.to_department !== ''
                              ? 'border-amber-300 bg-amber-50 text-amber-800'
                              : 'border-[var(--color-neutral)] bg-white',
                          ].join(' ')}
                        >
                          {DEPARTMENTS.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                        {isPending && (
                          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            unsaved
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-2.5">
                      {row.manually_set ? (
                        <span className="inline-block rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Manual</span>
                      ) : row.is_preset ? (
                        <span className="inline-block rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Preset</span>
                      ) : (
                        <span className="inline-block rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-400">—</span>
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
          className="fixed inset-0 z-50 m-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-black/40"
        >
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Preview Changes</h2>
            <p className="text-sm text-gray-500 mt-1">
              {pendingArray.length} reclassification{pendingArray.length !== 1 ? 's' : ''} to save
            </p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="pb-2 pr-3">Vendor</th>
                  <th className="pb-2 pr-3">GL Account</th>
                  <th className="pb-2 pr-3">Current</th>
                  <th className="pb-2 px-1"></th>
                  <th className="pb-2">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingArray.map((c) => (
                  <tr key={`${c.financial_row}||${c.entity_name}`}>
                    <td className="py-2 pr-3 font-mono text-xs">{c.entity_name}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-gray-500 max-w-[130px] truncate">{c.financial_row}</td>
                    <td className="py-2 pr-3 text-gray-500">{labelDept(c.old_dept)}</td>
                    <td className="py-2 px-1 text-gray-400">→</td>
                    <td className="py-2 font-medium text-gray-900">{labelDept(c.new_dept)}</td>
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
