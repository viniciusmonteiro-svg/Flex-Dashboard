'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import { formatMonthShort } from '@/lib/format';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';

const DEPARTMENTS = ['Sales', 'Technology', 'Development', 'Administration', 'Finance', 'Other'] as const;

interface ReclassRow {
  financial_row: string;
  month_key:     string | null;
  from_channel:  string;
  to_department: string;
  description:   string | null;
  total_spend:   number;
}

interface DeptAlloc { department: string; total_allocated: number; gl_count: number; }

export default function GLReclassificationTab() {
  const [rows, setRows]           = useState<ReclassRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [toasts, setToasts]       = useState<ToastItem[]>([]);

  const [months, setMonths]               = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [search, setSearch]               = useState('');

  // Form state
  const [fRow, setFRow]     = useState('');
  const [fMonth, setFMonth] = useState<string>('');  // '' = no specific month (all periods)
  const [fCh, setFCh]       = useState('');
  const [fDept, setFDept]   = useState<string>(DEPARTMENTS[0]);
  const [fDesc, setFDesc]   = useState('');

  // VC rows for GL account dropdown
  const [vcRows, setVcRows] = useState<VendorClassificationRow[]>([]);

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
      const res  = await fetch('/api/gl-reclassifications');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Load failed');
      setRows(data.reclassifications);
    } catch {
      addToast('Failed to load reclassifications', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
    fetch('/api/vendor-classifications')
      .then((r) => r.json())
      .then((d) => { if (d.rows) setVcRows(d.rows); })
      .catch(() => {});
  }, [load]);

  // Distinct financial rows for the dropdown, filtered by search
  const financialRows = useMemo(() => {
    const seen = new Map<string, { channel: string; entity_names: string[] }>();
    for (const r of vcRows) {
      if (!r.financial_row) continue;
      if (!seen.has(r.financial_row)) {
        seen.set(r.financial_row, { channel: r.channel, entity_names: [r.entity_name] });
      } else {
        const ex = seen.get(r.financial_row)!;
        if (!ex.entity_names.includes(r.entity_name)) ex.entity_names.push(r.entity_name);
      }
    }
    return [...seen.entries()]
      .map(([fr, meta]) => ({ financial_row: fr, ...meta }))
      .sort((a, b) => a.financial_row.localeCompare(b.financial_row));
  }, [vcRows]);

  const filteredDropdownRows = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return financialRows;
    return financialRows.filter(
      (r) =>
        r.financial_row.toLowerCase().includes(q) ||
        r.entity_names.some((n) => n.toLowerCase().includes(q))
    );
  }, [financialRows, search]);

  // Filter displayed rows by selected month + search
  const displayRows = useMemo(() => {
    let out = rows;
    if (selectedMonth !== 'all') {
      out = out.filter((r) => r.month_key === selectedMonth);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (r) =>
          r.financial_row.toLowerCase().includes(q) ||
          r.from_channel.toLowerCase().includes(q) ||
          r.to_department.toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, selectedMonth, search]);

  const handleRowSelect = (fr: string) => {
    setFRow(fr);
    const match = financialRows.find((r) => r.financial_row === fr);
    setFCh(match?.channel ?? '');
  };

  const handleSave = async () => {
    if (!fRow || !fDept) { addToast('GL Account and Reclassified To are required', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/gl-reclassifications/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financial_row: fRow,
          month_key:     fMonth || null,
          from_channel:  fCh,
          to_department: fDept,
          description:   fDesc,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      addToast('Reclassification saved', 'success');
      setShowForm(false);
      setFRow(''); setFMonth(''); setFCh(''); setFDept(DEPARTMENTS[0]); setFDesc('');
      await load();
    } catch {
      addToast('Save failed — please retry', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: ReclassRow) => {
    const label = r.month_key
      ? `${r.financial_row} (${formatMonthShort(r.month_key)})`
      : r.financial_row;
    if (!window.confirm(`Remove the reclassification for "${label}"?`)) return;
    try {
      const res = await fetch('/api/gl-reclassifications/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ financial_row: r.financial_row, month_key: r.month_key }),
      });
      if (!res.ok) throw new Error('Delete failed');
      addToast('Reclassification removed', 'success');
      await load();
    } catch {
      addToast('Delete failed — please retry', 'error');
    }
  };

  const deptSummary: DeptAlloc[] = useMemo(() =>
    DEPARTMENTS.reduce<DeptAlloc[]>((acc, dept) => {
      const dr = displayRows.filter((r) => r.to_department === dept);
      if (!dr.length) return acc;
      acc.push({
        department:      dept,
        total_allocated: dr.reduce((s, r) => s + r.total_spend, 0),
        gl_count:        dr.length,
      });
      return acc;
    }, []),
  [displayRows]);

  const fmt = (d: number) =>
    d.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-8">

      {/* ── Header ── */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">G&L Reclassification</h2>
        <p className="mt-1 text-sm text-gray-500">
          Reclassify GL accounts away from marketing. Reclassified amounts are excluded from all channel cost totals.
        </p>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Viewing period:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by GL account or vendor name…"
          className="rounded-md border border-[var(--color-neutral)] px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* ── Section 1: Reclassified GL Accounts ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-gray-800">Reclassified GL Accounts</h3>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {showForm ? 'Cancel' : 'Add Reclassification'}
          </button>
        </div>

        {showForm && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">GL Account</label>
                <select
                  value={fRow}
                  onChange={(e) => handleRowSelect(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  size={1}
                >
                  <option value="">Select GL account…</option>
                  {filteredDropdownRows.map((r) => (
                    <option key={r.financial_row} value={r.financial_row}>
                      {r.financial_row}
                      {r.entity_names.length > 0 ? ` — ${r.entity_names.slice(0, 2).join(', ')}` : ''}
                    </option>
                  ))}
                </select>
                {search && (
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {filteredDropdownRows.length} of {financialRows.length} GL accounts match "{search}"
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Original Channel (auto-filled)</label>
                <input
                  type="text"
                  value={fCh}
                  readOnly
                  placeholder="Select a GL account first"
                  className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-500 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reclassified To</label>
                <select
                  value={fDept}
                  onChange={(e) => setFDept(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                >
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Apply to Month (optional)</label>
                <select
                  value={fMonth}
                  onChange={(e) => setFMonth(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                >
                  <option value="">All periods</option>
                  {months.map((m) => (
                    <option key={m} value={m}>{formatMonthShort(m)}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  placeholder="Optional note"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !fRow}
                className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Financial Row</th>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Original Channel</th>
                <th className="px-4 py-3">Reclassified To</th>
                <th className="px-4 py-3">Total Spend</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {[0, 1, 2, 3, 4, 5, 6].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    {search ? `No reclassifications match "${search}"` : 'No reclassifications defined'}
                  </td>
                </tr>
              ) : (
                displayRows.map((r) => (
                  <tr key={`${r.financial_row}||${r.month_key}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{r.financial_row}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {r.month_key ? formatMonthShort(r.month_key) : 'All'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.from_channel || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {r.to_department}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{fmt(r.total_spend)}</td>
                    <td className="px-4 py-3 text-gray-500">{r.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(r)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Department Allocation View ── */}
      {deptSummary.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-base font-medium text-gray-800">Department Allocation View</h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Total Allocated ($)</th>
                  <th className="px-4 py-3">GL Accounts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {deptSummary.map((d) => (
                  <tr key={d.department} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{d.department}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{fmt(d.total_allocated)}</td>
                    <td className="px-4 py-3 text-gray-500">{d.gl_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
