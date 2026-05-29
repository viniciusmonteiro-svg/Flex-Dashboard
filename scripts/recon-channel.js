const XLSX = require('xlsx');
const fs = require('fs');
const { Client } = require('pg');

const envLines = fs.readFileSync('.env.local', 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const QUARTERS = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026'];
const QUARTER_MONTHS = {
  'Q1 2025': ['2025-01', '2025-02', '2025-03'],
  'Q2 2025': ['2025-04', '2025-05', '2025-06'],
  'Q3 2025': ['2025-07', '2025-08', '2025-09'],
  'Q4 2025': ['2025-10', '2025-11', '2025-12'],
  'Q1 2026': ['2026-01', '2026-02', '2026-03'],
};
const MONTH_TO_Q = {};
for (const [q, ms] of Object.entries(QUARTER_MONTHS))
  ms.forEach((m) => (MONTH_TO_Q[m] = q));
const ALL_MONTHS = Object.values(QUARTER_MONTHS).flat();

// ── 1. Extract Excel (financial_row, entity_name, excel_channel, quarters) ──

const refPath =
  env.RECONCILIATION_REF_PATH ||
  'C:/Users/vmmon/Downloads/Untitled spreadsheet (6).xlsx';

const buf = fs.readFileSync(refPath);
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });

let currentFR = '';
const refRows = [];
for (const row of rows) {
  const c0 = String(row[0] ?? '').trim();
  const c1 = String(row[1] ?? '').trim();
  const c2 = String(row[2] ?? '').trim();
  if (/^\d{5}\s*-\s*/.test(c0) && c1 === '' && c2 === '') {
    currentFR = c0;
    continue;
  }
  if (!c0 || c0.startsWith('Total') || c1 === '' || c0 === 'Financial Row / Vendor') continue;
  const qVals = {};
  let hasVal = false;
  QUARTERS.forEach((q, i) => {
    const v = typeof row[3 + i] === 'number' ? row[3 + i] : 0;
    qVals[q] = v;
    if (v !== 0) hasVal = true;
  });
  if (!hasVal) continue;
  refRows.push({ financial_row: currentFR, entity_name: c0, excel_channel: c1, quarters: qVals });
}
console.log('Ref rows:', refRows.length);

async function main() {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  // DB: amounts per (financial_row, entity_name, month_key) + DB channel
  const { rows: dbRows } = await client.query(
    `SELECT
       n.financial_row,
       n.entity_name,
       n.month_key,
       SUM(n.amount) AS total_cents,
       COALESCE(vc.channel, 'Unclassified') AS db_channel
     FROM netsuite_actuals n
     LEFT JOIN vendor_classifications vc
       ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
     WHERE n.month_key = ANY($1::text[])
     GROUP BY n.financial_row, n.entity_name, n.month_key, vc.channel`,
    [ALL_MONTHS]
  );
  await client.end();
  console.log('DB rows:', dbRows.length);

  // Build DB lookup: key -> { db_channel, quarters: Map<q, dollars> }
  const dbMap = new Map();
  for (const r of dbRows) {
    const q = MONTH_TO_Q[r.month_key];
    if (!q) continue;
    const key = r.financial_row + '|||' + r.entity_name;
    if (!dbMap.has(key)) dbMap.set(key, { db_channel: r.db_channel, quarters: new Map() });
    const entry = dbMap.get(key);
    entry.quarters.set(q, (entry.quarters.get(q) || 0) + Number(r.total_cents) / 100);
  }

  // ── Sheet 1: Vendor-level channel comparison ────────────────────────────

  const refKeys = new Set(refRows.map((r) => r.financial_row + '|||' + r.entity_name));
  const vendorRows = [];

  for (const ref of refRows) {
    const key = ref.financial_row + '|||' + ref.entity_name;
    const db = dbMap.get(key) || { db_channel: 'Not in DB', quarters: new Map() };

    const excelCh = ref.excel_channel;
    const dbCh = db.db_channel;

    let channelStatus;
    if (dbCh === 'Not in DB') channelStatus = 'Not in DB';
    else if (dbCh === 'Unclassified') channelStatus = 'Unclassified in DB';
    else if (excelCh === dbCh) channelStatus = 'Match';
    else channelStatus = 'MISMATCH';

    let totalRef = 0, totalDb = 0;
    const row = {
      'GL Account': ref.financial_row,
      'Vendor / Entity': ref.entity_name,
      'Excel Channel': excelCh,
      'DB Channel': dbCh,
      'Channel Status': channelStatus,
    };
    for (const q of QUARTERS) {
      const rv = ref.quarters[q] || 0;
      const dv = db.quarters.get(q) || 0;
      row[q + ' Ref $'] = rv;
      row[q + ' DB $'] = dv;
      row[q + ' Diff $'] = rv - dv;
      totalRef += rv;
      totalDb += dv;
    }
    row['Total Ref $'] = totalRef;
    row['Total DB $'] = totalDb;
    row['Total Diff $'] = totalRef - totalDb;
    vendorRows.push(row);
  }

  // DB-only rows (in DB but not in Excel ref)
  for (const [key, db] of dbMap) {
    if (refKeys.has(key)) continue;
    const [fr, en] = key.split('|||');
    let totalDb = 0;
    const row = {
      'GL Account': fr,
      'Vendor / Entity': en,
      'Excel Channel': 'Not in Ref',
      'DB Channel': db.db_channel,
      'Channel Status': 'Not in Ref',
    };
    for (const q of QUARTERS) {
      const dv = db.quarters.get(q) || 0;
      row[q + ' Ref $'] = 0;
      row[q + ' DB $'] = dv;
      row[q + ' Diff $'] = -dv;
      totalDb += dv;
    }
    row['Total Ref $'] = 0;
    row['Total DB $'] = totalDb;
    row['Total Diff $'] = -totalDb;
    vendorRows.push(row);
  }

  // Sort: mismatches first, then by |diff|
  const statusOrder = {
    MISMATCH: 0,
    'Unclassified in DB': 1,
    'Not in DB': 2,
    'Not in Ref': 3,
    Match: 4,
  };
  vendorRows.sort((a, b) => {
    const so =
      (statusOrder[a['Channel Status']] ?? 5) -
      (statusOrder[b['Channel Status']] ?? 5);
    if (so !== 0) return so;
    return Math.abs(b['Total Diff $']) - Math.abs(a['Total Diff $']);
  });

  // ── Sheet 2: Channel-level spend (Excel channel vs DB channel) ──────────

  const excelChMap = new Map(); // excel_channel -> per-quarter totals
  const dbChMap = new Map();    // db_channel    -> per-quarter totals

  for (const ref of refRows) {
    const ch = ref.excel_channel;
    if (!excelChMap.has(ch)) {
      const m = {};
      QUARTERS.forEach((q) => (m[q] = 0));
      excelChMap.set(ch, m);
    }
    const m = excelChMap.get(ch);
    QUARTERS.forEach((q) => (m[q] += ref.quarters[q] || 0));
  }

  for (const [, db] of dbMap) {
    const ch = db.db_channel;
    if (!dbChMap.has(ch)) {
      const m = {};
      QUARTERS.forEach((q) => (m[q] = 0));
      dbChMap.set(ch, m);
    }
    const m = dbChMap.get(ch);
    for (const [q, v] of db.quarters) {
      if (m[q] !== undefined) m[q] += v;
    }
  }

  const allChannels = [
    ...new Set([...excelChMap.keys(), ...dbChMap.keys()]),
  ].sort();

  const channelRows = [];
  for (const ch of allChannels) {
    const ex = excelChMap.get(ch) || {};
    const db = dbChMap.get(ch) || {};
    const row = { Channel: ch };
    let totalRef = 0, totalDb = 0;
    for (const q of QUARTERS) {
      row[q + ' Excel $'] = ex[q] || 0;
      row[q + ' DB $'] = db[q] || 0;
      row[q + ' Diff $'] = (ex[q] || 0) - (db[q] || 0);
      totalRef += ex[q] || 0;
      totalDb += db[q] || 0;
    }
    row['Total Excel $'] = totalRef;
    row['Total DB $'] = totalDb;
    row['Total Diff $'] = totalRef - totalDb;
    channelRows.push(row);
  }
  channelRows.sort(
    (a, b) => Math.abs(b['Total Diff $']) - Math.abs(a['Total Diff $'])
  );

  // ── Sheet 3: Channel mismatches only ────────────────────────────────────

  const mismatchRows = vendorRows.filter(
    (r) =>
      r['Channel Status'] === 'MISMATCH' ||
      r['Channel Status'] === 'Unclassified in DB'
  );

  // ── Write workbook ───────────────────────────────────────────────────────

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(vendorRows),
    'Vendor x Channel'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(channelRows),
    'Channel Summary'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(mismatchRows),
    'Channel Mismatches'
  );

  const outPath =
    'C:/Users/vmmon/Downloads/Reconciliation_ByChannel_' +
    new Date().toISOString().slice(0, 10) +
    '.xlsx';

  XLSX.writeFile(wbOut, outPath);
  console.log('Written to:', outPath);

  const statCounts = {};
  for (const r of vendorRows)
    statCounts[r['Channel Status']] = (statCounts[r['Channel Status']] || 0) + 1;
  console.log('Channel status breakdown:', JSON.stringify(statCounts, null, 2));
  console.log(
    'Channels in Excel:',
    excelChMap.size,
    '| Channels in DB:',
    dbChMap.size
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
