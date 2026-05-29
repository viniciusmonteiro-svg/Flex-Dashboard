import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { SourceDefinition, NetsuiteRow, MarketingLeadsRow, SalesforceRow } from './types';

type AnyRow = NetsuiteRow | MarketingLeadsRow | SalesforceRow;

function parseXlsx(filePath: string, headerRowIndex: number): Record<string, string>[] {
  // Read into a buffer first — XLSX.readFile() can fail on Windows shortcut/UNC
  // paths (e.g. G:\.shortcut-targets-by-id\...). Using fs.readFileSync + XLSX.read
  // hands raw bytes directly to the parser and avoids that path-handling bug.
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw: false → use the cell's formatted display value.
  // This ensures date cells (e.g. col D "9/30/2025") come back as the
  // human-readable string rather than an Excel serial number or Date object,
  // which parseTransactionDate (and other text parsers) can handle correctly.
  // Amount cells formatted as "$300.00" / "($405.68)" are already handled by
  // parseAmount, so no other parsers are affected.
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    range: headerRowIndex,
    defval: '',
    raw: false,
  });
}

function parseCsv(filePath: string): Record<string, string>[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
  return result.data;
}

function validateColumns(rows: Record<string, string>[], required: string[], filePath: string): void {
  if (rows.length === 0) {
    throw new Error(`[parser] No rows found in ${filePath}`);
  }
  // Trim header names before checking — XLSX may include trailing spaces.
  const headers = Object.keys(rows[0]).map((h) => h.trim());
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `[parser] Missing required columns in ${filePath}: ${missing.join(', ')}\n` +
        `Found: ${headers.join(', ')}`
    );
  }
}

function warnIfOffPeriod(
  rows: Record<string, string>[],
  expectedMonthKey: string,
  filePath: string
): void {
  const offPeriod = rows.filter((r) => (r.month_key ?? '').trim() !== expectedMonthKey);
  if (offPeriod.length / rows.length > 0.2) {
    console.warn(
      `[parser] WARNING: ${offPeriod.length}/${rows.length} rows in ${path.basename(filePath)} ` +
        `have month_key outside expected period ${expectedMonthKey}`
    );
  }
}

export function parseFile<TRow extends AnyRow>(
  source: SourceDefinition<TRow>,
  filePath: string,
  expectedMonthKey: string
): TRow[] {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  let rawRows: Record<string, string>[];
  if (ext === '.xlsx' || ext === '.xls') {
    rawRows = parseXlsx(filePath, source.headerRowIndex ?? 0);
  } else if (ext === '.csv') {
    rawRows = parseCsv(filePath);
  } else {
    throw new Error(`[parser] Unsupported file extension: ${ext}`);
  }

  validateColumns(rawRows, source.requiredColumns, filePath);

  // Warn on off-period only for sources with a month_key column
  if (source.requiredColumns.includes('month_key')) {
    warnIfOffPeriod(rawRows, expectedMonthKey, filePath);
  }

  return source.parseRows(rawRows, filename);
}
