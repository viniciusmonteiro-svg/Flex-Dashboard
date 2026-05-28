import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import * as XLSX from 'xlsx';
import fs from 'fs';

// ─── Constants ────────────────────────────────────────────────────────────────

const QUARTERS = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026'] as const;
type Quarter = (typeof QUARTERS)[number];

const QUARTER_MONTHS: Record<Quarter, string[]> = {
  'Q1 2025': ['2025-01', '2025-02', '2025-03'],
  'Q2 2025': ['2025-04', '2025-05', '2025-06'],
  'Q3 2025': ['2025-07', '2025-08', '2025-09'],
  'Q4 2025': ['2025-10', '2025-11', '2025-12'],
  'Q1 2026': ['2026-01', '2026-02', '2026-03'],
};

const ALL_MONTHS = Object.values(QUARTER_MONTHS).flat();

// month_key → quarter label
const MONTH_TO_QUARTER: Record<string, Quarter> = {};
for (const [q, months] of Object.entries(QUARTER_MONTHS)) {
  for (const m of months) MONTH_TO_QUARTER[m] = q as Quarter;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RefRow {
  financial_row: string;
  entity_name: string;
  quarters: Record<string, number>; // dollars
}

export interface QuarterAmounts {
  ref: number; // dollars
  db: number; // dollars
  diff: number; // ref - db
}

export type RowStatus =
  | 'match'
  | 'small_diff'
  | 'large_diff'
  | 'missing_from_db'
  | 'not_in_ref';

export interface ReconciliationRow {
  financial_row: string;
  entity_name: string;
  quarters: Record<string, QuarterAmounts>;
  total_ref: number;
  total_db: number;
  total_diff: number;
  status: RowStatus;
}

export interface ReconciliationSummary {
  total_rows: number;
  matched: number;
  small_diff: number;
  large_diff: number;
  missing_from_db: number;
  not_in_ref: number;
  total_abs_discrepancy: number;
}

export interface ReconciliationResponse {
  rows: ReconciliationRow[];
  summary: ReconciliationSummary;
  financial_rows: string[];
  quarters: string[];
  ref_path: string;
}

// ─── Excel parser ─────────────────────────────────────────────────────────────

function extractReferenceData(filePath: string): RefRow[] {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { defval: '', header: 1 });

  let currentFinancialRow = '';
  const extracted: RefRow[] = [];

  for (const raw of rows) {
    const row = raw as unknown[];
    const col0 = String(row[0] ?? '').trim();
    const col1 = String(row[1] ?? '').trim();
    const col2 = String(row[2] ?? '').trim();

    // Financial row header: "60001 - Wages & Salaries" with blank channel/notes cols
    if (/^\d{5}\s*-\s*/.test(col0) && col1 === '' && col2 === '') {
      currentFinancialRow = col0;
      continue;
    }

    // Skip header, total, section, and blank rows
    if (
      !col0 ||
      col0.startsWith('Total') ||
      col1 === '' ||
      col0 === 'Financial Row / Vendor'
    ) {
      continue;
    }

    // Columns 3-7 are Q1 2025 … Q1 2026
    const qVals: Record<string, number> = {};
    let hasValue = false;
    QUARTERS.forEach((q, i) => {
      const raw = row[3 + i];
      const val = typeof raw === 'number' ? raw : 0;
      qVals[q] = val;
      if (val !== 0) hasValue = true;
    });

    if (!hasValue) continue;

    extracted.push({
      financial_row: currentFinancialRow,
      entity_name: col0,
      quarters: qVals,
    });
  }

  return extracted;
}

// ─── Status classifier ────────────────────────────────────────────────────────

function classifyStatus(
  total_ref: number,
  total_db: number,
  total_diff: number
): RowStatus {
  const absDiff = Math.abs(total_diff);
  if (total_ref !== 0 && total_db === 0) return 'missing_from_db';
  if (total_ref === 0 && total_db !== 0) return 'not_in_ref';
  if (absDiff < 1) return 'match';
  if (absDiff < 100) return 'small_diff';
  return 'large_diff';
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await initDb();

    // Resolve reference file path
    const refPath =
      process.env.RECONCILIATION_REF_PATH ??
      String(
        process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users\\vmmon'
      ) + '\\Downloads\\Untitled spreadsheet (6).xlsx';

    if (!fs.existsSync(refPath)) {
      return NextResponse.json(
        {
          error: `Reference file not found: ${refPath}. Set RECONCILIATION_REF_PATH in .env.local.`,
        },
        { status: 404 }
      );
    }

    // 1. Extract reference data from Excel
    const refRows = extractReferenceData(refPath);

    // 2. Query DB for all relevant months
    type DbRow = { financial_row: string; entity_name: string; month_key: string; total_cents: string };
    const dbRows = await query<DbRow>(
      `SELECT financial_row, entity_name, month_key, SUM(amount) AS total_cents
       FROM netsuite_actuals
       WHERE month_key = ANY($1::text[])
       GROUP BY financial_row, entity_name, month_key`,
      [ALL_MONTHS]
    );

    // 3. Build DB lookup: key → quarter → dollars
    type DbLookup = Map<string, Map<string, number>>;
    const dbLookup: DbLookup = new Map();

    for (const row of dbRows) {
      const q = MONTH_TO_QUARTER[row.month_key];
      if (!q) continue;
      const key = `${row.financial_row}|||${row.entity_name}`;
      if (!dbLookup.has(key)) dbLookup.set(key, new Map());
      const qMap = dbLookup.get(key)!;
      qMap.set(q, (qMap.get(q) ?? 0) + Number(row.total_cents) / 100);
    }

    // 4. Build ref lookup for "not_in_ref" detection
    const refKeys = new Set(refRows.map((r) => `${r.financial_row}|||${r.entity_name}`));

    // 5. Merge ref → reconciliation rows
    const reconciled: ReconciliationRow[] = [];

    for (const ref of refRows) {
      const key = `${ref.financial_row}|||${ref.entity_name}`;
      const dbQMap = dbLookup.get(key) ?? new Map<string, number>();

      let total_ref = 0;
      let total_db = 0;
      const quarters: Record<string, QuarterAmounts> = {};

      for (const q of QUARTERS) {
        const ref_q = ref.quarters[q] ?? 0;
        const db_q = dbQMap.get(q) ?? 0;
        const diff_q = ref_q - db_q;
        quarters[q] = { ref: ref_q, db: db_q, diff: diff_q };
        total_ref += ref_q;
        total_db += db_q;
      }

      const total_diff = total_ref - total_db;

      reconciled.push({
        financial_row: ref.financial_row,
        entity_name: ref.entity_name,
        quarters,
        total_ref,
        total_db,
        total_diff,
        status: classifyStatus(total_ref, total_db, total_diff),
      });
    }

    // 6. Add DB-only rows (not in ref)
    for (const [key, qMap] of dbLookup) {
      if (refKeys.has(key)) continue;
      const [financial_row, entity_name] = key.split('|||');
      const quarters: Record<string, QuarterAmounts> = {};
      let total_db = 0;

      for (const q of QUARTERS) {
        const db_q = qMap.get(q) ?? 0;
        quarters[q] = { ref: 0, db: db_q, diff: -db_q };
        total_db += db_q;
      }

      reconciled.push({
        financial_row,
        entity_name,
        quarters,
        total_ref: 0,
        total_db,
        total_diff: -total_db,
        status: 'not_in_ref',
      });
    }

    // 7. Summary
    const summary: ReconciliationSummary = {
      total_rows: reconciled.length,
      matched: reconciled.filter((r) => r.status === 'match').length,
      small_diff: reconciled.filter((r) => r.status === 'small_diff').length,
      large_diff: reconciled.filter((r) => r.status === 'large_diff').length,
      missing_from_db: reconciled.filter((r) => r.status === 'missing_from_db').length,
      not_in_ref: reconciled.filter((r) => r.status === 'not_in_ref').length,
      total_abs_discrepancy: reconciled.reduce((sum, r) => sum + Math.abs(r.total_diff), 0),
    };

    const financial_rows = [...new Set(reconciled.map((r) => r.financial_row))].sort();

    return NextResponse.json({
      rows: reconciled,
      summary,
      financial_rows,
      quarters: [...QUARTERS],
      ref_path: refPath,
    } satisfies ReconciliationResponse);
  } catch (err) {
    console.error('[api/reconciliation]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
