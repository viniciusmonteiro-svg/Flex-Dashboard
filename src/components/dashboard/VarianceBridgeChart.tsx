'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { formatCurrency } from '@/lib/format';

interface BridgeRow {
  channel: string;
  variance: number;
}

interface Props {
  data: BridgeRow[];
}

function cssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function VarianceBridgeChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--color-neutral)]">
        No data
      </div>
    );
  }

  const successColor = cssVar('--color-success');
  const dangerColor = cssVar('--color-danger');

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 48)}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => formatCurrency(v)}
          tick={{ fontSize: 12 }}
        />
        <YAxis
          type="category"
          dataKey="channel"
          width={140}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          formatter={(value: number) => [formatCurrency(value), 'Variance']}
          labelStyle={{ fontWeight: 600 }}
        />
        <ReferenceLine x={0} stroke="#e2e8f0" />
        <Bar dataKey="variance" radius={[0, 3, 3, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.channel}
              fill={entry.variance <= 0 ? successColor : dangerColor}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
