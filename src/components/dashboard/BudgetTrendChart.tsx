'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency, formatMonth } from '@/lib/format';
import { CHART_TOKENS } from '@/lib/chartTokens';

interface TrendRow {
  month_key: string;
  budget: number;
  actual: number;
}

interface Props {
  data: TrendRow[];
}

export function BudgetTrendChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--color-neutral)]">
        No data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="month_key"
          tickFormatter={formatMonth}
          tick={{ fontSize: 12 }}
        />
        <YAxis
          tickFormatter={(v) => formatCurrency(v)}
          tick={{ fontSize: 12 }}
          width={90}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            formatCurrency(value),
            name === 'budget' ? 'Budget' : 'Actual',
          ]}
          labelFormatter={formatMonth}
        />
        <Legend
          formatter={(value) => (value === 'budget' ? 'Budget' : 'Actual')}
        />
        <Line
          type="monotone"
          dataKey="budget"
          stroke={CHART_TOKENS.budget}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke={CHART_TOKENS.spend}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
