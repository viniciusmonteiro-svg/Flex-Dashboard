import type { SourceDefinition, NetsuiteRow } from '../types';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const SECTION_HEADERS = new Set([
  'Ordinary Income/Expense',
  'Income',
  'Expense',
  'Net Income',
  'Gross Profit',
  'Net Ordinary Income',
  'Cost Of Sales',
  'Other Income and Expenses',
  'Net Other Income',
  'Other Income/Expense',
  'Other Expense',
]);

function parseAmount(raw: string | undefined): number {
  // "$17,980.07" → 1798007  |  "-$1,209.29" → -120929  |  blank → 0
  const s = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!s || s === '-') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Derive month_key from filename.
 * Handles both filename patterns:
 *   Old: "CustomBudgetvs.Actual(Dept_VendorLevel)-01.2026.xls"  → "2026-01"
 *   New: "CurveMonthlyMarketingReport(BF)-01.2026.xls"          → "2026-01"
 */
function deriveMonthKey(filename: string): string {
  const match = filename.match(/(\d{2})\.(\d{4})\.xls$/i);
  return match ? `${match[2]}-${match[1]}` : '';
}

/** True when the filename is the new CurveMonthlyMarketingReport(BF) format. */
function isNewFormat(filename: string): boolean {
  return /\(BF\)-\d{2}\.\d{4}\.xls$/i.test(filename);
}

/** Parse "9/30/2025" → "2025-09-30", or return null on bad input. */
function parseTransactionDate(raw: string | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  if (!m || !d || !y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const MONTH_ABBR: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Parse "Oct 2025" → "2025-10", or return null on bad input. */
function parseAccountingPeriod(raw: string | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const match = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const mm = MONTH_ABBR[match[1]];
  return mm ? `${match[2]}-${mm}` : null;
}

// ─── Row parsers ───────────────────────────────────────────────────────────────

/**
 * Old format: CustomBudgetvs.Actual(Dept_VendorLevel)-MM.YYYY.xls
 *   A: Financial Row (carry-forward)
 *   Entity: Name (Grouped) → entity_name
 *   Amount → amount
 */
function parseOldFormat(rows: Record<string, string>[], month_key: string): NetsuiteRow[] {
  const out: NetsuiteRow[] = [];
  let currentFinancialRow = '';

  for (const row of rows) {
    const rawFR = String(row['Financial Row'] ?? '').trim();
    const entity_name = String(row['Entity: Name (Grouped)'] ?? '').trim();

    if (/^total/i.test(rawFR)) continue;

    if (rawFR) {
      if (SECTION_HEADERS.has(rawFR)) continue;
      currentFinancialRow = rawFR;
      if (!entity_name) continue;
    }

    if (!currentFinancialRow || !entity_name) continue;

    out.push({
      source: 'netsuite',
      month_key,
      financial_row: currentFinancialRow,
      entity_name,
      amount: parseAmount(row['Amount']),
      transaction_date: null,
      accounting_period: null,
      description: null,
    });
  }

  return out;
}

/**
 * New format: CurveMonthlyMarketingReport(BF)-MM.YYYY.xls
 *   A:  Financial Row (carry-forward — same logic as old format)
 *   D:  Date → transaction_date
 *   E:  Accounting Period → accounting_period
 *   G:  Name → entity_name
 *   J:  Description → description
 *   M:  Amount → amount
 *
 * Skip rows where entity_name AND description are both blank
 * (pure journal entry with no identifying info).
 */
function parseNewFormat(rows: Record<string, string>[], month_key: string): NetsuiteRow[] {
  const out: NetsuiteRow[] = [];
  let currentFinancialRow = '';

  for (const row of rows) {
    const rawFR = String(row['Financial Row'] ?? '').trim();
    const entity_name = String(row['Name'] ?? '').trim();
    const description = String(row['Description'] ?? '').trim() || null;

    // Total rows — skip and don't update carry-forward
    if (/^total/i.test(rawFR)) continue;

    // Non-blank financial_row → new group
    if (rawFR) {
      if (SECTION_HEADERS.has(rawFR)) continue;
      currentFinancialRow = rawFR;
      // Group header rows have no entity and no description — carry forward only
      if (!entity_name && !description) continue;
    }

    if (!currentFinancialRow) continue;

    // Skip pure journal entries with zero identifying info
    if (!entity_name && !description) continue;

    const transaction_date = parseTransactionDate(row['Date']);
    const accounting_period =
      parseAccountingPeriod(row['Accounting Period']) ??
      // Fall back to filename month if accounting period column is blank
      month_key;

    out.push({
      source: 'netsuite',
      month_key,
      financial_row: currentFinancialRow,
      entity_name,
      amount: parseAmount(row['Amount']),
      transaction_date,
      accounting_period,
      description,
    });
  }

  return out;
}

// ─── Source definition ─────────────────────────────────────────────────────────

export const netsuiteSpend: SourceDefinition<NetsuiteRow> = {
  name: 'netsuiteSpend',
  label: 'NetSuite Actuals',
  subFolder: '1. Netsuite',
  fileExtension: '.xls',
  monthFolderPattern: /^\d{4}$/,
  headerRowIndex: 6,
  // Both formats share these two column headers at the header row
  requiredColumns: ['Financial Row', 'Amount'],

  parseRows(rows, filename): NetsuiteRow[] {
    const month_key = deriveMonthKey(filename);
    return isNewFormat(filename)
      ? parseNewFormat(rows, month_key)
      : parseOldFormat(rows, month_key);
  },
};
