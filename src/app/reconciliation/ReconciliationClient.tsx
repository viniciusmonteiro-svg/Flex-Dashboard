'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import type {
  ReconciliationResponse,
  ReconciliationRow,
  RowStatus,
} from '@/app/api/reconciliation/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDollar(n: number, forceSign = false): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(abs);
  if (forceSign) return (n < 0 ? '-' : '+') + formatted;
  return n < 0 ? `-${formatted}` : formatted;
}

function fmtDiff(n: number): string {
  if (Math.abs(n) < 0.5) return '—';
  return fmtDollar(n, true);
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  RowStatus,
  { label: string; rowBg: string; badgeCls: string; dotCls: string }
> = {
  match: {
    label: 'Match',
    rowBg: 'bg-green-50',
    badgeCls: 'bg-green-100 text-green-800',
    dotCls: 'bg-green-500',
  },
  small_diff: {
    label: 'Small diff',
    rowBg: 'bg-yellow-50',
    badgeCls: 'bg-yellow-100 text-yellow-800',
    dotCls: 'bg-yellow-500',
  },
  large_diff: {
    label: 'Large diff',
    rowBg: 'bg-red-50',
    badgeCls: 'bg-red-100 text-red-800',
    dotCls: 'bg-red-500',
  },
  missing_from_db: {
    label: 'Missing from DB',
    rowBg: 'bg-blue-50',
    badgeCls: 'bg-blue-100 text-blue-800',
    dotCls: 'bg-blue-500',
  },
  not_in_ref: {
    label: 'Not in ref',
    rowBg: 'bg-purple-50',
    badgeCls: 'bg-purple-100 text-purple-800',
    dotCls: 'bg-purple-500',
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RowStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cfg.badgeCls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dotCls)} />
      {cfg.label}
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

function KpiCard({ label, value, sub, color = 'text-gray-900' }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', color)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function ReconciliationClient() {
  const [data, setData] = useState<ReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [quarterFilter, setQuarterFilter] = useState<string>('All');
  const [glFilter, setGlFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [discrepanciesOnly, setDiscrepanciesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'diff' | 'ref' | 'entity'>('diff');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reconciliation');
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Derived table rows ───────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    if (!data) return [];
    let rows = [...data.rows];

    if (discrepanciesOnly) {
      rows = rows.filter((r) => r.status !== 'match');
    }
    if (glFilter !== 'All') {
      rows = rows.filter((r) => r.financial_row === glFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.entity_name.toLowerCase().includes(q) ||
          r.financial_row.toLowerCase().includes(q)
      );
    }

    // Sort
    rows.sort((a, b) => {
      if (sortBy === 'diff') return Math.abs(b.total_diff) - Math.abs(a.total_diff);
      if (sortBy === 'ref') return b.total_ref - a.total_ref;
      return a.entity_name.localeCompare(b.entity_name);
    });

    return rows;
  }, [data, discrepanciesOnly, glFilter, search, sortBy]);

  // ─── GL Account summary ───────────────────────────────────────────────────

  const glSummary = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      { total_ref: number; total_db: number; total_diff: number; count: number }
    >();
    for (const row of filteredRows) {
      const existing = map.get(row.financial_row) ?? { total_ref: 0, total_db: 0, total_diff: 0, count: 0 };
      map.set(row.financial_row, {
        total_ref: existing.total_ref + row.total_ref,
        total_db: existing.total_db + row.total_db,
        total_diff: existing.total_diff + row.total_diff,
        count: existing.count + 1,
      });
    }
    return [...map.entries()]
      .map(([gl, v]) => ({ gl, ...v }))
      .sort((a, b) => Math.abs(b.total_diff) - Math.abs(a.total_diff));
  }, [filteredRows]);

  // ─── Per-row display amounts based on quarter filter ─────────────────────

  function getDisplayAmounts(row: ReconciliationRow) {
    if (quarterFilter === 'All') {
      return { ref: row.total_ref, db: row.total_db, diff: row.total_diff };
    }
    const q = row.quarters[quarterFilter] ?? { ref: 0, db: 0, diff: 0 };
    return { ref: q.ref, db: q.db, diff: q.diff };
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[var(--color-primary)]" />
        <span className="ml-3 text-sm text-gray-500">Loading reconciliation data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-800">Failed to load reconciliation</h2>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <p className="mt-3 text-xs text-gray-500">
            Make sure <code className="rounded bg-gray-100 px-1">RECONCILIATION_REF_PATH</code> in{' '}
            <code className="rounded bg-gray-100 px-1">.env.local</code> points to your reference Excel
            file.
          </p>
          <button
            onClick={fetchData}
            className="mt-4 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { summary, financial_rows, quarters, ref_path } = data;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation</h1>
          <p className="mt-0.5 text-xs text-gray-400 truncate max-w-xl">
            Reference: {ref_path}
          </p>
          <p className="mt-1 text-xs text-gray-500 italic">
            Channel amounts reflect the classification active in each month, not the current classification.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
        >
          Refresh
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Rows" value={summary.total_rows} />
        <KpiCard
          label="Matched"
          value={summary.matched}
          sub={`${Math.round((summary.matched / summary.total_rows) * 100)}%`}
          color="text-green-700"
        />
        <KpiCard
          label="Small Diffs"
          value={summary.small_diff}
          sub="< $100"
          color="text-yellow-700"
        />
        <KpiCard
          label="Large Diffs"
          value={summary.large_diff}
          sub=">= $100"
          color="text-red-700"
        />
        <KpiCard
          label="Missing from DB"
          value={summary.missing_from_db}
          color="text-blue-700"
        />
        <KpiCard
          label="Total Discrepancy"
          value={fmtDollar(summary.total_abs_discrepancy)}
          sub="sum of |diffs|"
          color={summary.total_abs_discrepancy > 0 ? 'text-red-700' : 'text-green-700'}
        />
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        {/* Discrepancies only toggle */}
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700 select-none">
          <input
            type="checkbox"
            checked={discrepanciesOnly}
            onChange={(e) => setDiscrepanciesOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-[var(--color-primary)]"
          />
          Discrepancies only
        </label>

        <div className="h-5 w-px bg-gray-200" />

        {/* Quarter filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">Quarter</span>
          <select
            value={quarterFilter}
            onChange={(e) => setQuarterFilter(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <option value="All">All quarters</option>
            {quarters.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        </div>

        {/* GL Account filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">GL Account</span>
          <select
            value={glFilter}
            onChange={(e) => setGlFilter(e.target.value)}
            className="max-w-[240px] truncate rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <option value="All">All GL accounts</option>
            {financial_rows.map((fr) => (
              <option key={fr} value={fr}>{fr}</option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <option value="diff">Largest diff</option>
            <option value="ref">Largest ref</option>
            <option value="entity">Vendor A–Z</option>
          </select>
        </div>

        {/* Search */}
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Search vendor or GL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-800 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>

        {(discrepanciesOnly || glFilter !== 'All' || search || quarterFilter !== 'All') && (
          <button
            onClick={() => {
              setDiscrepanciesOnly(false);
              setGlFilter('All');
              setSearch('');
              setQuarterFilter('All');
            }}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* ── Main comparison table ── */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Vendor Comparison
            {quarterFilter !== 'All' && (
              <span className="ml-2 text-xs font-normal text-gray-400">— {quarterFilter}</span>
            )}
          </h2>
          <span className="text-xs text-gray-400">{filteredRows.length} rows</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 whitespace-nowrap">GL Account</th>
                <th className="px-4 py-2 whitespace-nowrap">Vendor / Entity</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">Ref ($)</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">DB ($)</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">Diff</th>
                <th className="px-4 py-2 whitespace-nowrap">Status</th>
                {quarterFilter === 'All' && (
                  <>
                    {quarters.map((q) => (
                      <th key={q} className="px-3 py-2 text-right whitespace-nowrap text-[10px]">
                        {q} Δ
                      </th>
                    ))}
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6 + (quarterFilter === 'All' ? quarters.length : 0)} className="px-4 py-8 text-center text-sm text-gray-400">
                    No rows match current filters
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const cfg = STATUS_CONFIG[row.status];
                  const { ref, db, diff } = getDisplayAmounts(row);
                  return (
                    <tr key={idx} className={cn('hover:brightness-95 transition-colors', cfg.rowBg)}>
                      <td className="px-4 py-2 text-xs text-gray-600 max-w-[180px]">
                        <span className="block truncate" title={row.financial_row}>
                          {row.financial_row}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-800 max-w-[200px]">
                        <span className="block truncate" title={row.entity_name}>
                          {row.entity_name}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700 tabular-nums whitespace-nowrap">
                        {fmtDollar(ref)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700 tabular-nums whitespace-nowrap">
                        {fmtDollar(db)}
                      </td>
                      <td className={cn(
                        'px-4 py-2 text-right font-semibold tabular-nums whitespace-nowrap',
                        Math.abs(diff) < 1 ? 'text-gray-400' :
                        diff > 0 ? 'text-red-600' : 'text-green-600'
                      )}>
                        {fmtDiff(diff)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                      {quarterFilter === 'All' && (
                        <>
                          {quarters.map((q) => {
                            const qd = row.quarters[q]?.diff ?? 0;
                            return (
                              <td
                                key={q}
                                className={cn(
                                  'px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap',
                                  Math.abs(qd) < 1 ? 'text-gray-300' :
                                  qd > 0 ? 'text-red-500' : 'text-green-600'
                                )}
                                title={`Ref: ${fmtDollar(row.quarters[q]?.ref ?? 0)} | DB: ${fmtDollar(row.quarters[q]?.db ?? 0)}`}
                              >
                                {Math.abs(qd) < 1 ? '—' : fmtDiff(qd)}
                              </td>
                            );
                          })}
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── GL Account Summary ── */}
      {glSummary.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">GL Account Summary</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">GL Account</th>
                  <th className="px-4 py-2 text-right">Vendors</th>
                  <th className="px-4 py-2 text-right">Total Ref</th>
                  <th className="px-4 py-2 text-right">Total DB</th>
                  <th className="px-4 py-2 text-right">Total Diff</th>
                  <th className="px-4 py-2 text-right">|Diff|</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {glSummary.map(({ gl, total_ref, total_db, total_diff, count }) => {
                  const absDiff = Math.abs(total_diff);
                  return (
                    <tr key={gl} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2 text-xs font-medium text-gray-700 max-w-[220px]">
                        <span className="block truncate" title={gl}>{gl}</span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{count}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                        {fmtDollar(total_ref)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                        {fmtDollar(total_db)}
                      </td>
                      <td className={cn(
                        'px-4 py-2 text-right tabular-nums font-semibold whitespace-nowrap',
                        absDiff < 1 ? 'text-gray-400' :
                        total_diff > 0 ? 'text-red-600' : 'text-green-600'
                      )}>
                        {fmtDiff(total_diff)}
                      </td>
                      <td className={cn(
                        'px-4 py-2 text-right tabular-nums whitespace-nowrap',
                        absDiff < 1 ? 'text-gray-300' :
                        absDiff < 100 ? 'text-yellow-600' : 'text-red-600'
                      )}>
                        {absDiff < 1 ? '—' : fmtDollar(absDiff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
