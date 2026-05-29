import path from 'path';
import { parseFile } from './parser';
import { upsertNetsuiteActuals, upsertLeads, upsertOpportunities, upsertIngestedFile, deleteNetsuiteActualsByMonth } from './writer';
import type {
  SourceDefinition,
  ClassifiedFile,
  NetsuiteRow,
  MarketingLeadsRow,
  SalesforceRow,
  IngestResult,
} from './types';

export interface IngestOptions {
  /** Dry-run: parse and count rows but do not write to the database */
  preview?: boolean;
  /** Called after each file is processed (or skipped) */
  onProgress?: (msg: string) => void;
}

export async function ingestFiles(
  source: SourceDefinition,
  files: ClassifiedFile[],
  opts: IngestOptions = {}
): Promise<IngestResult> {
  const { preview = false, onProgress } = opts;
  const log = (msg: string) => {
    onProgress?.(msg);
    console.log(msg);
  };

  const toProcess = files.filter((f) => f.status === 'new' || f.status === 'updated');
  const skipped = files.filter((f) => f.status === 'unchanged');
  let rows_ingested = 0;
  const errors: string[] = [];

  if (preview) {
    log(`[pipeline] PREVIEW — ${source.label}: ${toProcess.length} to process, ${skipped.length} unchanged`);
  }

  for (const file of toProcess) {
    log(`[pipeline] ${preview ? 'Preview' : 'Processing'} ${file.fileName} (${file.status})`);

    try {
      const rows = parseFile(source, file.path, file.monthKey);

      if (!preview) {
        if (source.name === 'netsuiteSpend') {
          // Delete existing rows for this month before re-inserting, so that
          // vendors removed from the updated source file do not linger in the DB.
          if (file.monthKey) {
            await deleteNetsuiteActualsByMonth(file.monthKey);
          }
          await upsertNetsuiteActuals(rows as NetsuiteRow[]);
        } else if (source.name === 'salesforceLeads') {
          await upsertOpportunities(rows as SalesforceRow[]);
        } else {
          // Fallback for any future MarketingLeads-style CSV source
          await upsertLeads(rows as MarketingLeadsRow[]);
        }

        await upsertIngestedFile({
          file_path: file.path,
          file_name: file.fileName,
          source_type: source.name,
          parent_folder: file.parentFolder,
          file_size_bytes: file.fileSizeBytes,
          file_mtime: file.fileMtime,
          row_count: rows.length,
          status: 'ok',
        });
      }

      rows_ingested += rows.length;
      log(`[pipeline] ✓ ${file.fileName} — ${rows.length} rows${preview ? ' (preview)' : ' ingested'}`);
    } catch (err) {
      const msg = `${file.fileName}: ${(err as Error).message}`;
      errors.push(msg);
      log(`[pipeline] ✗ ${msg}`);

      if (!preview) {
        await upsertIngestedFile({
          file_path: file.path,
          file_name: file.fileName,
          source_type: source.name,
          parent_folder: file.parentFolder,
          file_size_bytes: file.fileSizeBytes,
          file_mtime: file.fileMtime,
          row_count: 0,
          status: 'error',
          notes: (err as Error).message,
        }).catch(() => { /* best-effort */ });
      }
    }
  }

  return { rows_ingested, files_processed: toProcess.length, files_skipped: skipped.length, errors };
}
