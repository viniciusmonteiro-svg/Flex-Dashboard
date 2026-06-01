'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import type { VendorClassificationRow } from '@/app/api/vendor-classifications/route';

const DEPARTMENTS = ['Sales', 'Technology', 'Development', 'Administration', 'Finance', 'Other'] as const;

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
  total_spend:      number;
}

export default function IntercompanyTab() {
  const [allocs, setAllocs]       = useState<Allocation[]>([]);
  const [vcRows, setVcRows]       = useState<VendorClassificationRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [toasts, setToasts]       = useState<ToastItem[]>([]);

  // Form
  const [fVendor, setFVendor]     = useState('');
  const [fRow, setFRow]           = useState('');
  const [fMktPct, setFMktPct]     = useState('80');
  const [fOtherDept, setFOtherDept] = useState<string>(DEPARTMENTS[0]);
  const [fFrom, setFFrom]         = useState('');
  const [fTo, setFTo]             = useState('');
  const [fDesc, setFDesc]         = useState('');

  const mktNum   = parseFloat(fMktPct) || 0;
  const otherPct = parseFloat((100 - mktNum).toFixed(2));
  const pctError = isNaN(parseFloat(fMktPct)) || mktNum < 0 || mktNum > 100;

  const addToast = useCallback((msg: string, type: ToastItem['type']) => {
    const id = crypto.randomUUID();
    setToasts((p) => [...p, { id, message: msg, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((p) => p.filter((t) => t.id !== id)), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, vRes] = await Promise.all([
        fetch('/api/intercompany'),
        fetch('/api/vendor-classifications'),
      ]);
      const aData = await aRes.json();
      const vData = await vRes.json();
      if (aData.allocations) setAllocs(aData.allocations);
      if (vData.rows)        setVcRows(vData.rows);
    } catch {
      addToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const vendors = useMemo(
    () => [...new Set(vcRows.map((r) => r.entity_name))].sort(),
    [vcRows]
  );
  const rowsForVendor = useMemo(
    () => [...new Set(vcRows.filter((r) => r.entity_name === fVendor).map((r) => r.financial_row))].sort(),
    [vcRows, fVendor]
  );

  const resetForm = () => {
    setFVendor(''); setFRow(''); setFMktPct('80');
    setFOtherDept(DEPARTMENTS[0]); setFFrom(''); setFTo(''); setFDesc('');
  };

  const handleSave = async () => {
    if (!fVendor || !fRow) { addToast('Vendor and GL Account are required', 'error'); return; }
    if (pctError)           { addToast('Marketing % must be between 0 and 100', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/intercompany/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financial_row:    fRow,
          entity_name:      fVendor,
          marketing_pct:    mktNum,
          other_department: fOtherDept,
          other_pct:        otherPct,
          valid_from:       fFrom || null,
          valid_to:         fTo   || null,
          description:      fDesc || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      addToast('Allocation saved', 'success');
      setShowForm(false);
      resetForm();
      await load();
    } catch (e) {
      addToast((e as Error).message ?? 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Remove this intercompany allocation?')) return;
    try {
      const res = await fetch('/api/intercompany/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      addToast('Allocation removed', 'success');
      await load();
    } catch {
      addToast('Delete failed — please retry', 'error');
    }
  };

  const fmt = (d: number) =>
    d.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Intercompany</h2>
        <p className="mt-1 text-sm text-gray-500">
          Split a vendor's GL cost between marketing and another department by percentage.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => { setShowForm((v) => !v); if (showForm) resetForm(); }}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {showForm ? 'Cancel' : 'Add Allocation'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
              <select
                value={fVendor}
                onChange={(e) => { setFVendor(e.target.value); setFRow(''); }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              >
                <option value="">Select vendor…</option>
                {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">GL Account</label>
              <select
                value={fRow}
                onChange={(e) => setFRow(e.target.value)}
                disabled={!fVendor}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
              >
                <option value="">Select GL account…</option>
                {rowsForVendor.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Marketing %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={fMktPct}
                onChange={(e) => setFMktPct(e.target.value)}
                className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] ${pctError ? 'border-red-400' : 'border-gray-300'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Other % (auto-calculated)</label>
              <input
                type="number"
                value={otherPct}
                readOnly
                className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Other Department</label>
              <select
                value={fOtherDept}
                onChange={(e) => setFOtherDept(e.target.value)}
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
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Valid From (optional)</label>
              <input
                type="month"
                value={fFrom}
                onChange={(e) => setFFrom(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Valid To (optional)</label>
              <input
                type="month"
                value={fTo}
                onChange={(e) => setFTo(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              />
            </div>
          </div>
          {pctError && (
            <p className="text-xs font-medium text-red-600">
              Marketing % must be between 0 and 100 (Other % auto-completes to 100 − Marketing %)
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || pctError || !fVendor || !fRow}
              className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setShowForm(false); resetForm(); }}
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
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">GL Account</th>
              <th className="px-4 py-3">Mkt %</th>
              <th className="px-4 py-3">Other Dept</th>
              <th className="px-4 py-3">Other %</th>
              <th className="px-4 py-3">Valid From</th>
              <th className="px-4 py-3">Valid To</th>
              <th className="px-4 py-3">Total Spend</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : allocs.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  No intercompany allocations defined
                </td>
              </tr>
            ) : (
              allocs.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-900">{a.entity_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{a.financial_row}</td>
                  <td className="px-4 py-3 tabular-nums font-medium text-gray-900">{a.marketing_pct.toFixed(1)}%</td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                      {a.other_department}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-600">{a.other_pct.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-gray-500">{a.valid_from ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.valid_to ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">{fmt(a.total_spend)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(a.id)}
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
