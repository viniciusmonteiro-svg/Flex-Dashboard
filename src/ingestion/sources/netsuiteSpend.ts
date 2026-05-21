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
 * Matches: CurveMonthlyMarketingReport(BF)-MM.YYYY.xls → "YYYY-MM"
 */
function deriveMonthKey(filename: string): string {
  const match = filename.match(/\(BF\)-(\d{2})\.(\d{4})\.xls$/i);
  return match ? `${match[2]}-${match[1]}` : '';
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

// ─── Source definition ─────────────────────────────────────────────────────────

/**
 * NetSuite Actuals — CurveMonthlyMarketingReport(BF)-MM.YYYY.xls
 *
 * Column layout (header row at Excel row 7, i.e. headerRowIndex: 6):
 *   A: Financial Row  — carry-forward group header (same logic as legacy format)
 *   D: Date           — transaction date  "9/30/2025" → "2025-09-30"
 *   E: Accounting Period — "Oct 2025" → "2025-10"
 *   G: Name           → entity_name
 *   J: Description    → description (trim, null if blank)
 *   M: Amount         → cents  "$1,234.56" / "-$9.99"
 *
 * Skip rules:
 *   - Rows starting with "Total" (don't update carry-forward either)
 *   - Known section-header strings in column A
 *   - Group header rows (non-blank A, blank G+J) — carry forward only
 *   - Rows where both entity_name AND description are blank
 */
export const netsuiteSpend: SourceDefinition<NetsuiteRow> = {
  name: 'netsuiteSpend',
  label: 'NetSuite Actuals',
  subFolder: '1. Netsuite',
  fileExtension: '.xls',
  monthFolderPattern: /^\d{4}$/,
  headerRowIndex: 6,
  requiredColumns: ['Financial Row', 'Amount'],

  parseRows(rows, filename): NetsuiteRow[] {
    const month_key = deriveMonthKey(filename);
    const out: NetsuiteRow[] = [];
    let currentFinancialRow = '';

    for (const row of rows) {
      const rawFR      = String(row['Financial Row'] ?? '').trim();
      const entity_name = String(row['Name']         ?? '').trim();
      const description = String(row['Description']  ?? '').trim() || null;

      // Total rows — skip without updating carry-forward
      if (/^total/i.test(rawFR)) continue;

      // Non-blank financial_row → potential new group header
      if (rawFR) {
        if (SECTION_HEADERS.has(rawFR)) continue;
        currentFinancialRow = rawFR;
        // Pure group header: has a GL label but no entity or description — carry forward only
        if (!entity_name && !description) continue;
      }

      // No current group yet — skip
      if (!currentFinancialRow) continue;

      // Skip pure journal entries with no identifying detail
      if (!entity_name && !description) continue;

      const transaction_date  = parseTransactionDate(row['Date']);
      const accounting_period =
        parseAccountingPeriod(row['Accounting Period']) ?? month_key;

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
  },
};
