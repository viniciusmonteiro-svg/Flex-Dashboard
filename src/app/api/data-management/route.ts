import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query, queryOne } from '@/db/query';
import { getSources } from '@/ingestion/registry';
import { scanSource, buildSourcePath } from '@/ingestion/scanner';
import type { SourceDefinition, ClassifiedFile } from '@/ingestion/types';

// ─── Response types ────────────────────────────────────────────────────────────

export interface DmFileInfo {
  filename: string;
  file_path: string;
  month_key: string;
  /** Filesystem comparison result */
  scan_status: 'new' | 'updated' | 'unchanged' | 'not_synced';
  /** Row count stored in ingested_files (null = never ingested) */
  db_rows: number | null;
  /** Status from ingested_files (null = never ingested) */
  db_status: 'ok' | 'pending' | 'error' | null;
  ingested_at: string | null;
  error: string | null;
}

export interface DmSourceSection {
  folder_path: string;
  total_rows: number;
  last_ingested_at: string | null;
  files: DmFileInfo[];
}

export interface DataManagementResponse {
  last_scan_at: string;
  netsuite: DmSourceSection;
  salesforce: DmSourceSection;
}

// ─── DB record shape from ingested_files ──────────────────────────────────────

interface DbFileRow {
  file_path: string;
  file_name: string | null;
  row_count: number | null;
  status: string | null;
  notes: string | null;
  ingested_at: string | null;
}

// ─── Per-source builder ────────────────────────────────────────────────────────

async function buildSection(
  source: SourceDefinition,
  rowTable: string
): Promise<DmSourceSection> {
  const folderPath = buildSourcePath(source);

  // Scan filesystem (returns [] if folder missing)
  const diskFiles: ClassifiedFile[] = await scanSource(source);
  const diskByPath = new Map(diskFiles.map((f) => [f.path, f]));

  // Parallel DB queries
  const [totalResult, lastIngestedResult, dbFiles] = await Promise.all([
    queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${rowTable}`),
    queryOne<{ ingested_at: string | null }>(
      `SELECT MAX(ingested_at)::text AS ingested_at
         FROM ingested_files
        WHERE source_type = $1`,
      [source.name]
    ),
    query<DbFileRow>(
      `SELECT file_path, file_name, row_count, status, notes, ingested_at::text
         FROM ingested_files
        WHERE source_type = $1`,
      [source.name]
    ),
  ]);

  const dbByPath = new Map(dbFiles.map((r) => [r.file_path, r]));

  // Build file list — disk files first
  const files: DmFileInfo[] = diskFiles.map((f) => {
    const db = dbByPath.get(f.path);
    // If file changed since last ingest and DB shows ok → mark as pending
    const dbStatus: DmFileInfo['db_status'] = db
      ? db.status === 'ok' && f.status === 'updated'
        ? 'pending'
        : (db.status as DmFileInfo['db_status'])
      : null;

    return {
      filename: f.fileName,
      file_path: f.path,
      month_key: f.monthKey,
      scan_status: f.status as DmFileInfo['scan_status'],
      db_rows: db?.row_count ?? null,
      db_status: dbStatus,
      ingested_at: db?.ingested_at ?? null,
      error: db?.notes ?? null,
    };
  });

  // Add DB-only files (not on disk = Google Drive not synced)
  for (const [filePath, db] of dbByPath) {
    if (!diskByPath.has(filePath)) {
      files.push({
        filename: db.file_name ?? filePath.split(/[\\/]/).pop() ?? filePath,
        file_path: filePath,
        month_key: '',
        scan_status: 'not_synced',
        db_rows: db.row_count,
        db_status: db.status as DmFileInfo['db_status'],
        ingested_at: db.ingested_at,
        error: db.notes,
      });
    }
  }

  // Sort newest month first, then by filename
  files.sort((a, b) =>
    b.month_key.localeCompare(a.month_key) || a.filename.localeCompare(b.filename)
  );

  return {
    folder_path: folderPath,
    total_rows: parseInt(totalResult?.count ?? '0', 10),
    last_ingested_at: lastIngestedResult?.ingested_at ?? null,
    files,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await initDb();

    const sources = getSources();
    const netsuite = sources.find((s) => s.name === 'netsuiteSpend')!;
    const salesforce = sources.find((s) => s.name === 'salesforceLeads')!;

    const [netsuiteSection, salesforceSection] = await Promise.all([
      buildSection(netsuite, 'netsuite_actuals'),
      buildSection(salesforce, 'salesforce_opportunities'),
    ]);

    return NextResponse.json({
      last_scan_at: new Date().toISOString(),
      netsuite: netsuiteSection,
      salesforce: salesforceSection,
    } satisfies DataManagementResponse);
  } catch (err) {
    console.error('[api/data-management]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
