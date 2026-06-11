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
  // "$17,980.07"  → 1798007
  // "-$1,209.29"  → -120929
  // "($405.68)"   → -40568   (Excel accounting format for negatives)
  // blank / "-"   → 0
  let s = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!s || s === '-') return 0;
  // Parenthetical negative: "(405.68)" → "-405.68"
  if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
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

/** Parse "9/30/2025" or "9/30/25" → "2025-09-30", or return null on bad input. */
function parseTransactionDate(raw: string | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  if (!m || !d || !y) return null;
  // Normalise 2-digit year → 4-digit (all our data is 2000s)
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
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
 *   G: Name           → entity_name (primary)
 *   I: Memo           → description fallback / entity_name fallback #3
 *   J: Description    → description (primary) / entity_name fallback #2
 *   M: Amount         → cents  "$1,234.56" / "-$9.99"
 *
 * Entity name fallback chain: Name (G) → Description (J) → Memo (I) → '-Unassigned-'
 * Description fallback chain: Description (J) → Memo (I) → null
 *
 * Skip rules:
 *   - Rows starting with "Total" (don't update carry-forward either)
 *   - Known section-header strings in column A
 *   - Group header rows (non-blank A, blank G+J+I) — carry forward only
 *   - Rows where Name AND Description AND Memo are all blank
 */
export const netsuiteSpend: SourceDefinition<NetsuiteRow> = {
  name: 'netsuiteSpend',
  label: 'NetSuite Actuals',
  subFolder: '1. NetSuite',
  fileExtension: '.xls',
  monthFolderPattern: /^\d{4}$/,
  headerRowIndex: 6,
  requiredColumns: ['Financial Row', 'Amount'],

  parseRows(rows, filename): NetsuiteRow[] {
    const month_key = deriveMonthKey(filename);
    const out: NetsuiteRow[] = [];
    let currentFinancialRow = '';

    for (const row of rows) {
      const rawFR  = String(row['Financial Row'] ?? '').trim();

      // Name column — col G
      const nameG = String(row['Name'] ?? '').trim();

      // Description columns — col J first, col I (Memo) as fallback
      const descJ  = String(row['Description'] ?? '').trim(); // col J
      const memoI  = String(row['Memo']        ?? '').trim(); // col I
      const description = descJ || memoI || null;

      // Total rows — skip without updating carry-forward
      if (/^total/i.test(rawFR)) continue;

      // Non-blank financial_row → potential new group header
      if (rawFR) {
        if (SECTION_HEADERS.has(rawFR)) continue;
        currentFinancialRow = rawFR;
        // Pure group header: GL label only, no name and no description — carry forward only
        if (!nameG && !description) continue;
      }

      // No current group yet — skip
      if (!currentFinancialRow) continue;

      // Skip rows with zero identifying information
      if (!nameG && !description) continue;

      // has_name: true only when col G (Name) was non-blank.
      // entity_name falls back to description/memo text for row uniqueness — each
      // expense line stays distinct even when multiple name-blank rows share the
      // same financial_row. The UI uses has_name to show the "-Unassigned-" pattern.
      const has_name    = nameG !== '';
      const entity_name = nameG || descJ || memoI || '-Unassigned-';

      const transaction_date  = parseTransactionDate(row['Date']);
      // tx_month: the calendar month of the transaction ("YYYY-MM"), used as part
      // of the aggregation key so that cross-period entries (e.g. a Sep 30 expense
      // inside the Oct accounting file) are stored as a separate row from the Oct
      // transactions of the same vendor, enabling correct Transaction Date filtering.
      const tx_month          = transaction_date ? transaction_date.slice(0, 7) : '';
      const accounting_period =
        parseAccountingPeriod(row['Accounting Period']) ?? month_key;

      out.push({
        source: 'netsuite',
        month_key,
        financial_row: currentFinancialRow,
        entity_name,
        has_name,
        tx_month,
        amount: parseAmount(row['Amount']),
        transaction_date,
        accounting_period,
        description,
      });
    }

    return out;
  },
};
