'use client';

import { useEffect, useState } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
}

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(item.id), 200);
    }, item.duration ?? 3000);
    return () => clearTimeout(timer);
  }, [item, onDismiss]);

  const colorCls = {
    success: 'border-[var(--color-success)] bg-green-50 text-green-800',
    error: 'border-[var(--color-danger)] bg-red-50 text-red-800',
    info: 'border-gray-300 bg-white text-gray-700',
  }[item.type];

  return (
    <div
      className={`pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg transition-all duration-200 ${colorCls} ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {item.message}
    </div>
  );
}
