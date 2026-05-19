'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMonthShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { DataManagementResponse, DmFileInfo, DmSourceSection } from '@/app/api/data-management/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Badge components ─────────────────────────────────────────────────────────

function ScanBadge({ status }: { status: DmFileInfo['scan_status'] }) {
  const cfg: Record<DmFileInfo['scan_status'], { cls: string; label: string }> = {
    new:        { cls: 'bg-blue-100 text-blue-700',   label: 'new' },
    updated:    { cls: 'bg-amber-100 text-amber-700', label: 'updated' },
    unchanged:  { cls: 'bg-gray-100 text-gray-500',   label: 'unchanged' },
    not_synced: { cls: 'bg-red-100 text-red-700',     label: 'not synced' },
  };
  const { cls, label } = cfg[status];
  return (
    <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', cls)}>
      {label}
    </span>
  );
}

function DbBadge({ status }: { status: DmFileInfo['db_status'] }) {
  if (!status) return <span className="text-xs text-[var(--color-neutral)]">—</span>;
  const cfg: Record<NonNullable<DmFileInfo['db_status']>, { cls: string; label: string }> = {
    ok:      { cls: 'bg-green-100 text-green-700',  label: 'ok' },
    pending: { cls: 'bg-yellow-100 text-yellow-700',label: 'pending' },
    error:   { cls: 'bg-red-100 text-red-700',      label: 'error' },
  };
  const { cls, label } = cfg[status];
  return (
    <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', cls)}>
      {label}
    </span>
  );
}

// ─── Source section ───────────────────────────────────────────────────────────

interface SourceSectionProps {
  title: string;
  sourceKey: 'netsuite' | 'salesforce';
  section: DmSourceSection;
  showMonth: boolean;
  scanning: boolean;
  ingesting: boolean;
  onScan: () => void;
  onIngest: () => void;
}

function SourceSection({
  title,
  section,
  showMonth,
  scanning,
  ingesting,
  onScan,
  onIngest,
}: SourceSectionProps) {
  const busy = scanning || ingesting;
  const needsAction = section.files.some(
    (f) => f.scan_status === 'new' || f.scan_status === 'updated'
  );

  return (
    <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-[var(--color-band)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{title}</span>
            <span className="text-xs text-[var(--color-neutral)]">
              {section.total_rows.toLocaleString()} rows in DB
            </span>
          </div>
          <p className="mt-0.5 text-xs font-mono text-gray-400 truncate max-w-[420px]">
            {section.folder_path}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onIngest}
            disabled={busy || !needsAction}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              'bg-[var(--color-primary)] text-white',
              (busy || !needsAction)
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:opacity-90'
            )}
          >
            {ingesting ? 'Ingesting…' : 'Ingest Files'}
          </button>
          <button
            onClick={onScan}
            disabled={busy}
            className={cn(
              'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors',
              busy ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'
            )}
          >
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
      </div>

      {/* File table */}
      {section.files.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--color-neutral)]">
          No files found in this folder.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-[var(--color-neutral)]">
                <th className="px-5 py-3 text-left">File</th>
                {showMonth && <th className="px-4 py-3 text-left">Month</th>}
                <th className="px-4 py-3 text-left">Scan</th>
                <th className="px-4 py-3 text-right">DB Rows</th>
                <th className="px-4 py-3 text-left">DB Status</th>
                <th className="px-5 py-3 text-left">Ingested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {section.files.map((file) => (
                <tr
                  key={file.file_path}
                  className={cn(
                    'hover:bg-[var(--color-band)]',
                    file.scan_status === 'not_synced' && 'opacity-60'
                  )}
                >
                  <td className="px-5 py-2.5 font-mono text-xs text-[var(--color-primary)] max-w-[260px] truncate">
                    {file.filename}
                  </td>
                  {showMonth && (
                    <td className="px-4 py-2.5 text-sm text-[var(--color-neutral)] whitespace-nowrap">
                      {file.month_key ? formatMonthShort(file.month_key) : '—'}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <ScanBadge status={file.scan_status} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-sm text-[var(--color-neutral)]">
                    {file.db_rows !== null ? file.db_rows.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <DbBadge status={file.db_status} />
                    {file.error && (
                      <p className="mt-0.5 text-xs text-[var(--color-danger)] leading-tight max-w-[200px] truncate" title={file.error}>
                        {file.error}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-neutral)] whitespace-nowrap">
                    {formatTs(file.ingested_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-gray-100 px-5 py-3 text-xs text-[var(--color-neutral)]">
        Click <strong>Ingest Files</strong> to load new or updated files into the database.
        Only files marked <em>new</em> or <em>updated</em> are processed.
      </div>
    </section>
  );
}

// ─── Ingest result toast ──────────────────────────────────────────────────────

interface IngestResult {
  source: string;
  label: string;
  rows_ingested: number;
  files_processed: number;
  errors: string[];
}

function IngestToast({ results, onDismiss }: { results: IngestResult[]; onDismiss: () => void }) {
  const hasErrors = results.some((r) => r.errors.length > 0);
  return (
    <div className={cn(
      'rounded-lg border px-5 py-4 text-sm',
      hasErrors
        ? 'border-red-200 bg-red-50'
        : 'border-green-200 bg-green-50'
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.source}>
              <p className={cn('font-medium', hasErrors ? 'text-red-800' : 'text-green-800')}>
                {r.label}: {r.files_processed} file{r.files_processed !== 1 ? 's' : ''} processed
                &nbsp;·&nbsp;{r.rows_ingested.toLocaleString()} rows ingested
              </p>
              {r.errors.map((e, i) => (
                <p key={i} className="text-xs text-[var(--color-danger)]">✗ {e}</p>
              ))}
            </div>
          ))}
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DataManagementClient() {
  const [data, setData] = useState<DataManagementResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ingestingSource, setIngestingSource] = useState<string | null>(null);
  const [ingestResults, setIngestResults] = useState<IngestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Scan (fetch data-management which runs the filesystem scan) ────────────
  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/data-management');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Scan failed');
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  // Auto-scan on mount
  useEffect(() => { scan(); }, [scan]);

  // ── Ingest ─────────────────────────────────────────────────────────────────
  const ingest = useCallback(async (source?: string) => {
    const key = source ?? 'all';
    setIngestingSource(key);
    setIngestResults(null);
    setError(null);
    try {
      const url = source ? `/api/ingest?source=${source}` : '/api/ingest';
      const res = await fetch(url, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Ingest failed');
      setIngestResults(json.results ?? []);
      // Re-scan to reflect new DB state
      await scan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIngestingSource(null);
    }
  }, [scan]);

  const busy = scanning || ingestingSource !== null;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">Data Management</h1>
          <p className="mt-1 text-sm text-[var(--color-neutral)]">
            Last full scan:{' '}
            <span className="font-medium">{formatTs(data?.last_scan_at ?? null)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={scan}
            disabled={busy}
            className={cn(
              'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors',
              busy ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'
            )}
          >
            {scanning ? 'Scanning…' : 'Scan All'}
          </button>
          <button
            onClick={() => ingest()}
            disabled={busy}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              'bg-[var(--color-primary)]',
              busy ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'
            )}
          >
            {ingestingSource === 'all' ? 'Ingesting…' : 'Ingest All'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {/* Ingest results */}
      {ingestResults && (
        <IngestToast results={ingestResults} onDismiss={() => setIngestResults(null)} />
      )}

      {/* Loading skeleton */}
      {scanning && !data && (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-[var(--color-band)]">
                <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
                <div className="mt-1.5 h-3 w-64 animate-pulse rounded bg-gray-100" />
              </div>
              <div className="divide-y divide-gray-50">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex gap-4 px-5 py-2.5">
                    {Array.from({ length: 5 }).map((_, k) => (
                      <div key={k} className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NetSuite section */}
      {data && (
        <SourceSection
          title="NetSuite"
          sourceKey="netsuite"
          section={data.netsuite}
          showMonth={true}
          scanning={scanning}
          ingesting={ingestingSource === 'netsuite'}
          onScan={scan}
          onIngest={() => ingest('netsuite')}
        />
      )}

      {/* Salesforce section */}
      {data && (
        <SourceSection
          title="Salesforce"
          sourceKey="salesforce"
          section={data.salesforce}
          showMonth={false}
          scanning={scanning}
          ingesting={ingestingSource === 'salesforce'}
          onScan={scan}
          onIngest={() => ingest('salesforce')}
        />
      )}
    </div>
  );
}
