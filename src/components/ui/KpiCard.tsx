import { cn } from '@/lib/cn';

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  /** When true, positive delta = unfavorable (red). Use for over-budget metrics. */
  invertDelta?: boolean;
}

export function KpiCard({ label, value, delta, deltaLabel, invertDelta = false }: KpiCardProps) {
  const deltaColor =
    delta === undefined || delta === 0
      ? 'text-[var(--color-neutral)]'
      : (invertDelta ? delta > 0 : delta < 0)
        ? 'text-[var(--color-danger)]'
        : 'text-[var(--color-success)]';

  const deltaSign = delta !== undefined && delta > 0 ? '+' : '';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[var(--color-neutral)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--color-primary)]">{value}</p>
      {delta !== undefined && (
        <p className={cn('mt-1 text-sm font-medium', deltaColor)}>
          {deltaSign}{delta}
          {deltaLabel && (
            <span className="ml-1 font-normal text-[var(--color-neutral)]">{deltaLabel}</span>
          )}
        </p>
      )}
    </div>
  );
}
