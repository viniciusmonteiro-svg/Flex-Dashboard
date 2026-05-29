import type { SourceDefinition, SalesforceRow } from '../types';

// Handle Excel serial dates (numbers) and common string date formats
function parseExcelDate(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;

  if (typeof raw === 'number') {
    // Excel serial date: days since 1899-12-30 (accounting for the 1900 leap year bug)
    const date = new Date(Math.round((raw - 25569) * 86400000));
    return date.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Numeric string that looks like an Excel serial
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 1000) {
      const date = new Date(Math.round((n - 25569) * 86400000));
      return date.toISOString().slice(0, 10);
    }
  }

  // MM/DD/YYYY or M/D/YYYY (4-digit year)
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // M/D/YY or MM/DD/YY (2-digit year — Salesforce XLS export uses this format)
  const mdyShortMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShortMatch) {
    const [, m, d, yy] = mdyShortMatch;
    // Y2K pivot: 00–69 → 2000s, 70–99 → 1900s
    const fullYear = parseInt(yy) < 70 ? 2000 + parseInt(yy) : 1900 + parseInt(yy);
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  return null;
}

function parseMrr(raw: string | undefined): number {
  const s = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!s || s === '-') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function deriveCreatedMonth(isoDate: string | null): string {
  if (!isoDate) return '';
  return isoDate.slice(0, 7); // YYYY-MM
}

export const salesforceLeads: SourceDefinition<SalesforceRow> = {
  name: 'salesforceLeads',
  label: 'Salesforce Pipeline',
  subFolder: '2. SalesForce',
  fileExtension: '.xls',
  monthFolderPattern: /^$/,   // unused — flatFile mode
  flatFile: true,
  headerRowIndex: 0,
  requiredColumns: [
    'Opportunity Name',
    'Account Name',
    'Created Date',
    'Stage',
  ],

  parseRows(rows): SalesforceRow[] {
    return rows
      .map((row) => {
        // Cast to unknown first since XLSX may return numbers for date/numeric cells.
        // Also build a whitespace-trimmed key map so headers like "Order Type "
        // (trailing space) are resolved correctly.
        const rawRow = row as unknown as Record<string, unknown>;
        const r: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawRow)) {
          r[k.trim()] = v;        // trim header key; value trimming done per-field
        }

        // Opportunity ID may be absent in newer exports — fall back to Opportunity Name
        const opportunityId =
          String(r['Opportunity ID'] ?? '').trim() ||
          String(r['Opportunity Name'] ?? '').trim();
        if (!opportunityId) return null;

        const createdDate = parseExcelDate(r['Created Date']);
        const closeDate = parseExcelDate(r['Close Date']);
        const createdMonth = deriveCreatedMonth(createdDate);

        const rawChannel = String(r['Primary Channel'] ?? '').trim();
        const primaryChannel = !rawChannel || rawChannel === '0' ? 'Unclassified' : rawChannel;

        const rawDemoed = r['Demoed'];
        const demoed =
          rawDemoed === 1 || rawDemoed === '1' ||
          rawDemoed === true || rawDemoed === 'true' ||
          String(rawDemoed ?? '').toLowerCase() === 'yes';

        // MRR column was renamed from "Monthly MRR (converted)" to "Total MRR (converted)"
        const rawMrr = (r['Total MRR (converted)'] ?? r['Monthly MRR (converted)']) as string;

        return {
          opportunity_id: opportunityId,
          opportunity_name: String(r['Opportunity Name'] ?? '').trim(),
          account_name: String(r['Account Name'] ?? '').trim(),
          created_date: createdDate,
          close_date: closeDate,
          stage: String(r['Stage'] ?? '').trim(),
          monthly_mrr: parseMrr(rawMrr),
          number_of_locations: parseInt(String(r['NUMBER OF LOCATIONS'] ?? '0')) || 0,
          primary_channel: primaryChannel,
          primary_campaign_source: String(r['Primary Campaign Source'] ?? '').trim(),
          primary_campaign_name: String(r['Primary Campaign Name'] ?? '').trim() || null,
          lead_source: String(r['Lead Source'] ?? '').trim(),
          opportunity_owner: String(r['Opportunity Owner'] ?? '').trim(),
          opp_type: String(r['Type'] ?? '').trim(),
          created_month: createdMonth,
          demoed,
          order_type: String(r['Order Type'] ?? '').trim(),
        } satisfies SalesforceRow;
      })
      .filter((r): r is SalesforceRow => r !== null);
  },
};
