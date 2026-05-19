import type { SourceDefinition, NetsuiteRow } from '../types';

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

function deriveMonthKey(filename: string): string {
  // "CustomBudgetvs.Actual(Dept_VendorLevel)-01.2026.xls" → "2026-01"
  const match = filename.match(/(\d{2})\.(\d{4})\.xls$/i);
  return match ? `${match[2]}-${match[1]}` : '';
}

export const netsuiteSpend: SourceDefinition<NetsuiteRow> = {
  name: 'netsuiteSpend',
  label: 'NetSuite Actuals',
  subFolder: '1. Netsuite',
  fileExtension: '.xls',
  monthFolderPattern: /^\d{4}$/,
  headerRowIndex: 6,
  requiredColumns: ['Financial Row', 'Entity: Name (Grouped)', 'Amount'],

  parseRows(rows, filename): NetsuiteRow[] {
    const month_key = deriveMonthKey(filename);
    const out: NetsuiteRow[] = [];
    let currentFinancialRow = '';

    for (const row of rows) {
      const rawFinancialRow = String(row['Financial Row'] ?? '').trim();
      const entity_name = String(row['Entity: Name (Grouped)'] ?? '').trim();

      // Total rows — skip and don't update currentFinancialRow
      if (/^total/i.test(rawFinancialRow)) continue;

      // Non-blank financial_row that isn't a total → becomes the new current group
      if (rawFinancialRow) {
        if (SECTION_HEADERS.has(rawFinancialRow)) continue;
        currentFinancialRow = rawFinancialRow;
        // Group header rows have no entity name — skip emitting but carry forward
        if (!entity_name) continue;
      }

      // Blank financial_row → inherits current group
      if (!currentFinancialRow) continue;
      if (!entity_name) continue;

      out.push({
        source: 'netsuite',
        month_key,
        financial_row: currentFinancialRow,
        entity_name,
        amount: parseAmount(row['Amount']),
      });
    }

    return out;
  },
};
