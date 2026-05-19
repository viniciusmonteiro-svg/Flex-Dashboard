'use client';

import { useEffect, useState, useCallback } from 'react';
import path from 'path';
import { formatMonth } from '@/lib/format';
import { cn } from '@/lib/cn';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatusData {
  latest_month: string | null;
  spend_rows: number;
  leads_rows: number;
  last_ingested_at: string | null;
}

interface HistoryRow {
  file_path: string;
  source_name: string;
  row_count: number;
  ingested_at: string;
}

interface PreviewSourceResult {
  source: string;
  new_files: number;
  updated_files: number;
  unchanged_files: number;
  invalid_files: number;
  files: { path: string; status: string }[];
}

interface IngestSourceResult {
  source: string;
  rows_ingested: number;
  files_processed: number;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', color)}>
      {children}
    </span>
  );
}

const STATUS_PILL: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  updated: 'bg-amber-100 text-amber-700',
  unchanged: 'bg-gray-100 text-gray-600',
  invalid: 'bg-red-100 text-red-700',
};

// ── Main component ────────────────────────────────────────────────────────────

export function DataManagementClient() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [previewResults, setPreviewResults] = useState<PreviewSourceResult[] | null>(null);
  const [ingestResults, setIngestResults] = useState<IngestSourceResult[] | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const busy = previewing || ingesting;

  const fetchStatus = useCallback(() => {
    setLoadingStatus(true);
    fetch('/api/data-management')
      .then((r) => r.json())
      .then((data: StatusData) => setStatus(data))
      .finally(() => setLoadingStatus(false));
  }, []);

  const fetchHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch('/api/ingest/status')
      .then((r) => r.json())
      .then((data: { rows: HistoryRow[] }) => setHistory(data.rows ?? []))
      .finally(() => setLoadingHistory(false));
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchHistory();
  }, [fetchStatus, fetchHistory]);

  async function handlePreview() {
    setPreviewing(true);
    setPreviewResults(null);
    setIngestResults(null);
    setIngestError(null);
    try {
      const res = await fetch('/api/ingest/preview', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Preview failed');
      setPreviewResults(data.results);
    } catch (err) {
      setIngestError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleIngest() {
    setIngesting(true);
    setIngestResults(null);
    setIngestError(null);
    try {
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Ingest failed');
      setIngestResults(data.results);
      fetchStatus();
      fetchHistory();
    } catch (err) {
      setIngestError((err as Error).message);
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-[var(--color-primary)]">Data Management</h1>

      {/* ── Data Status ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
          Data Status
        </h2>
        {loadingStatus ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Latest Month" value={status?.latest_month ? formatMonth(status.latest_month) : '—'} />
            <StatCard label="Spend Rows" value={status?.spend_rows?.toLocaleString() ?? '—'} />
            <StatCard label="Leads Rows" value={status?.leads_rows?.toLocaleString() ?? '—'} />
            <StatCard label="Last Ingested" value={status?.last_ingested_at ? formatTs(status.last_ingested_at) : '—'} small />
          </div>
        )}
      </section>

      {/* ── Ingest Controls ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
          Ingest Controls
        </h2>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handlePreview}
              disabled={busy}
              className={cn(
                'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-[var(--color-primary)] shadow-sm transition-colors',
                busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--color-band)]'
              )}
            >
              {previewing ? 'Scanning…' : 'Preview Changes'}
            </button>
            <button
              onClick={handleIngest}
              disabled={busy}
              className={cn(
                'rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors',
                busy ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90'
              )}
            >
              {ingesting ? 'Running…' : 'Run Ingest'}
            </button>
          </div>

          {/* Error */}
          {ingestError && (
            <div className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]">
              {ingestError}
            </div>
          )}

          {/* Preview results */}
          {previewResults && (
            <div className="mt-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
                Preview — no changes written
              </p>
              {previewResults.map((src) => (
                <div key={src.source}>
                  <p className="mb-2 text-sm font-medium text-[var(--color-primary)]">{src.source}</p>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Pill color="bg-blue-100 text-blue-700">{src.new_files} new</Pill>
                    <Pill color="bg-amber-100 text-amber-700">{src.updated_files} updated</Pill>
                    <Pill color="bg-gray-100 text-gray-600">{src.unchanged_files} unchanged</Pill>
                    {src.invalid_files > 0 && (
                      <Pill color="bg-red-100 text-red-700">{src.invalid_files} invalid</Pill>
                    )}
                  </div>
                  {src.files.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {src.files.map((f) => (
                        <li key={f.path} className="flex items-center gap-2 text-xs text-[var(--color-neutral)]">
                          <span className={cn('inline-block rounded px-1.5 py-0.5 font-medium', STATUS_PILL[f.status] ?? 'bg-gray-100')}>
                            {f.status}
                          </span>
                          <span className="font-mono">{basename(f.path)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Ingest results */}
          {ingestResults && (
            <div className="mt-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
                Ingest Complete
              </p>
              {ingestResults.map((src) => (
                <div key={src.source}>
                  <p className="mb-1 text-sm font-medium text-[var(--color-primary)]">{src.source}</p>
                  <p className="text-sm text-[var(--color-neutral)]">
                    {src.files_processed} files processed · {src.rows_ingested.toLocaleString()} rows ingested
                  </p>
                  {src.errors.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {src.errors.map((e, i) => (
                        <li key={i} className="text-xs text-[var(--color-danger)]">✗ {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Ingest History ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
          Ingest History
        </h2>
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          {loadingHistory ? (
            <div className="h-48 animate-pulse rounded-lg bg-gray-50" />
          ) : history.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--color-neutral)]">
              No files ingested yet. Run ingest to populate data.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-band)] text-xs font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
                  <tr>
                    <th className="px-5 py-3 text-left">File</th>
                    <th className="px-5 py-3 text-left">Source</th>
                    <th className="px-5 py-3 text-right">Rows</th>
                    <th className="px-5 py-3 text-left">Ingested At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--color-band)]">
                      <td className="px-5 py-3 font-mono text-xs text-[var(--color-primary)]">
                        {basename(row.file_path)}
                      </td>
                      <td className="px-5 py-3 text-[var(--color-neutral)]">{row.source_name}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-[var(--color-primary)]">
                        {row.row_count?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-[var(--color-neutral)]">
                        {formatTs(row.ingested_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[var(--color-neutral)]">{label}</p>
      <p className={cn('mt-1 font-bold text-[var(--color-primary)]', small ? 'text-base' : 'text-2xl')}>
        {value}
      </p>
    </div>
  );
}
