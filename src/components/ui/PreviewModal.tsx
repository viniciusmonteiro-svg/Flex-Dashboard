'use client';

import { useEffect, useRef } from 'react';
import { formatMonthShort } from '@/lib/format';

export interface PendingChange {
  financial_row: string;
  entity_name: string;
  old_channel: string;
  new_channel: string;
  month_key?: string; // present → month-specific; absent → global (all months)
}

interface PreviewModalProps {
  open: boolean;
  changes: PendingChange[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function PreviewModal({ open, changes, onConfirm, onCancel }: PreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  const hasMonthSpecific = changes.some((c) => !!c.month_key);
  const hasGlobal = changes.some((c) => !c.month_key);

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Preview Changes</h2>
        <p className="text-sm text-gray-500 mt-1">
          {changes.length} change{changes.length !== 1 ? 's' : ''} to save
        </p>

        {/* Scope summary banners */}
        {hasGlobal && (
          <p className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
            ⚠ Changes without a month will update <strong>all months</strong> for that vendor.
          </p>
        )}
        {hasMonthSpecific && (
          <p className="mt-1 rounded-md bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs text-blue-800">
            📅 Changes marked with a month will only update that specific period.
          </p>
        )}
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="pb-2">Vendor</th>
              <th className="pb-2">GL Account</th>
              <th className="pb-2">Scope</th>
              <th className="pb-2">Current</th>
              <th className="pb-2"></th>
              <th className="pb-2">New</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {changes.map((c) => (
              <tr key={`${c.financial_row}||${c.entity_name}||${c.month_key ?? 'all'}`}>
                <td className="py-2 pr-2 font-mono text-xs">{c.entity_name}</td>
                <td className="py-2 pr-2 font-mono text-[11px] text-gray-500 max-w-[130px] truncate">
                  {c.financial_row}
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {c.month_key ? (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      📅 {formatMonthShort(c.month_key)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      All months
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2 text-gray-500">{c.old_channel}</td>
                <td className="py-2 px-1 text-gray-400">→</td>
                <td className="py-2 font-medium text-gray-900">{c.new_channel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
        <button
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Confirm &amp; Save
        </button>
      </div>
    </dialog>
  );
}
