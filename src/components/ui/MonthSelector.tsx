'use client';

import { formatMonth } from '@/lib/format';

interface MonthSelectorProps {
  months: string[];
  selected: string;
  onChange: (month: string) => void;
}

export function MonthSelector({ months, selected, onChange }: MonthSelectorProps) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[var(--color-primary)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {formatMonth(m)}
        </option>
      ))}
    </select>
  );
}
