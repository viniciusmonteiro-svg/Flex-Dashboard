'use client';

import { useCallback, useEffect, useState } from 'react';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';

const MARKETING_CHANNELS = [
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
] as const;

interface AdjRow {
  channel:     string;
  amount:      number;  // dollars
  description: string | null;
}

export default function DepartmentAdjustmentTab() {
  const [adjs, setAdjs]               = useState<Map<string, AdjRow>>(new Map());
  const [loading, setLoading]         = useState(true);
  const [editingCh, setEditingCh]     = useState<string | null>(null);
  const [editAmount, setEditAmount]   = useState('');
  const [editDesc, setEditDesc]       = useState('');
  const [saving, setSaving]           = useState(false);
  const [toasts, setToasts]           = useState<ToastItem[]>([]);

  const addToast = useCallback((msg: string, type: ToastItem['type']) => {
    const id = crypto.randomUUID();
    setToasts((p) => [...p, { id, message: msg, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((p) => p.filter((t) => t.id !== id));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/adjustments');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Load failed');
      setAdjs(new Map((data.adjustments as AdjRow[]).map((a) => [a.channel, a])));
    } catch {
      addToast('Failed to load adjustments', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (ch: string) => {
    const ex = adjs.get(ch);
    setEditingCh(ch);
    setEditAmount(ex ? String(ex.amount) : '');
    setEditDesc(ex?.description ?? '');
  };

  const cancelEdit = () => { setEditingCh(null); setEditAmount(''); setEditDesc(''); };

  const saveEdit = async () => {
    if (!editingCh) return;
    const dollars = parseFloat(editAmount);
    if (isNaN(dollars)) { addToast('Enter a valid number', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/adjustments/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: editingCh, amount: dollars, description: editDesc }),
      });
      if (!res.ok) throw new Error('Save failed');
      addToast('Adjustment saved', 'success');
      cancelEdit();
      await load();
    } catch {
      addToast('Save failed — please retry', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeAdj = async (ch: string) => {
    if (!window.confirm(`Remove the adjustment for "${ch}"?`)) return;
    try {
      const res = await fetch('/api/adjustments/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: ch }),
      });
      if (!res.ok) throw new Error('Delete failed');
      addToast('Adjustment removed', 'success');
      await load();
    } catch {
      addToast('Delete failed — please retry', 'error');
    }
  };

  const fmtDollars = (d: number) => {
    const abs = Math.abs(d).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    return d < 0 ? `(${abs})` : abs;
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Department Adjustment</h2>
        <p className="mt-1 text-sm text-gray-500">
          Apply a fixed dollar adjustment to a channel's total cost. Affects all downstream calculations.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Current Adjustment ($)</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading
              ? Array.from({ length: MARKETING_CHANNELS.length }).map((_, i) => (
                  <tr key={i}>
                    {[0, 1, 2, 3].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : MARKETING_CHANNELS.map((ch) => {
                  const row       = adjs.get(ch);
                  const isEditing = editingCh === ch;

                  if (isEditing) {
                    return (
                      <tr key={ch} className="bg-blue-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{ch}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            placeholder="e.g. -10000 or 5000"
                            className="w-40 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            placeholder="Reason for adjustment"
                            className="w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const hasAdj = !!row;
                  return (
                    <tr key={ch} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{ch}</td>
                      <td
                        className={`px-4 py-3 tabular-nums ${
                          hasAdj && row.amount !== 0
                            ? row.amount < 0
                              ? 'text-red-600 font-medium'
                              : 'text-green-700 font-medium'
                            : 'text-gray-400'
                        }`}
                      >
                        {hasAdj ? fmtDollars(row.amount) : '$0.00'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row?.description ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => startEdit(ch)}
                            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                          >
                            Edit
                          </button>
                          {hasAdj && (
                            <button
                              onClick={() => removeAdj(ch)}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Adjustments are applied after vendor classification and affect all channel cost calculations across all tabs.
      </p>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
