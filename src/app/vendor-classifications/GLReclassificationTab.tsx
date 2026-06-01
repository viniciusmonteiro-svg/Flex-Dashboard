'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';

const DEPARTMENTS = ['Sales', 'Technology', 'Development', 'Administration', 'Finance', 'Other'] as const;

interface ReclassRow {
  financial_row: string;
  from_channel:  string;
  to_department: string;
  description:   string | null;
  total_spend:   number;
}

interface DeptAlloc {
  department:      string;
  total_allocated: number;
  gl_count:        number;
}

export default function GLReclassificationTab() {
  const [rows, setRows]         = useState<ReclassRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [toasts, setToasts]     = useState<ToastItem[]>([]);

  // Form state
  const [fRow, setFRow]   = useState('');
  const [fCh, setFCh]     = useState('');
  const [fDept, setFDept] = useState<string>(DEPARTMENTS[0]);
  const [fDesc, setFDesc] = useState('');

  // Vendor-classification rows for GL account dropdown
  const [vcRows, setVcRows] = useState<VendorClassificationRow[]>([]);

  const addToast = useCallback((msg: string, type: ToastItem['type']) => {
    const id = crypto.randomUUID();
    setToasts((p) => [...p, { id, message: msg, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((p) => p.filter((t) => t.id !== id)), []);

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
      .catch(() => {/* non-fatal */});
  }, [load]);

  // Distinct financial rows (sorted)
  const financialRows = useMemo(() => {
    const seen = new Map<string, string>(); // financial_row → channel
    for (const r of vcRows) {
      if (r.financial_row && !seen.has(r.financial_row)) {
        seen.set(r.financial_row, r.channel);
      }
    }
    return [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fr, ch]) => ({ financial_row: fr, channel: ch }));
  }, [vcRows]);

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
        body: JSON.stringify({ financial_row: fRow, from_channel: fCh, to_department: fDept, description: fDesc }),
      });
      if (!res.ok) throw new Error('Save failed');
      addToast('Reclassification saved', 'success');
      setShowForm(false);
      setFRow(''); setFCh(''); setFDept(DEPARTMENTS[0]); setFDesc('');
      await load();
    } catch {
      addToast('Save failed — please retry', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (financial_row: string) => {
    if (!window.confirm(`Remove the reclassification for "${financial_row}"?`)) return;
    try {
      const res = await fetch('/api/gl-reclassifications/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ financial_row }),
      });
      if (!res.ok) throw new Error('Delete failed');
      addToast('Reclassification removed', 'success');
      await load();
    } catch {
      addToast('Delete failed — please retry', 'error');
    }
  };

  const deptSummary: DeptAlloc[] = useMemo(() => {
    return DEPARTMENTS.reduce<DeptAlloc[]>((acc, dept) => {
      const deptRows = rows.filter((r) => r.to_department === dept);
      if (!deptRows.length) return acc;
      acc.push({
        department:      dept,
        total_allocated: deptRows.reduce((s, r) => s + r.total_spend, 0),
        gl_count:        deptRows.length,
      });
      return acc;
    }, []);
  }, [rows]);

  const fmt = (d: number) =>
    d.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">G&L Reclassification</h2>
        <p className="mt-1 text-sm text-gray-500">
          Reclassify GL accounts away from marketing. Reclassified amounts are excluded from all channel cost totals.
        </p>
      </div>

      {/* Section 1 — Reclassified GL Accounts */}
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
                >
                  <option value="">Select GL account…</option>
                  {financialRows.map((r) => (
                    <option key={r.financial_row} value={r.financial_row}>{r.financial_row}</option>
                  ))}
                </select>
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
                    {[0, 1, 2, 3, 4, 5].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No reclassifications defined
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.financial_row} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{r.financial_row}</td>
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
                        onClick={() => handleDelete(r.financial_row)}
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

      {/* Section 2 — Department Allocation View */}
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
