import pkg from 'pg';
const { Client } = pkg;
import { readFileSync } from 'fs';

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // ── 1. DB: Trade Show channel total for Q1 2026 ──────────────────────────
  const dbTotal = await client.query(`
    SELECT
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel,
      SUM(n.amount) AS total_cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
    GROUP BY COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY total_cents DESC
  `);
  console.log('=== DB channel totals for Q1 2026 ===');
  console.table(dbTotal.rows.map(r => ({
    channel: r.channel,
    total_dollars: (Number(r.total_cents)/100).toFixed(2)
  })));

  // ── 2. DB: Trade Show row-level breakdown ────────────────────────────────
  const dbRows = await client.query(`
    SELECT
      n.entity_name,
      n.financial_row,
      n.month_key,
      SUM(n.amount) AS cents,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') = 'Trade Show'
    GROUP BY n.entity_name, n.financial_row, n.month_key, COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY n.month_key, n.entity_name
  `);

  const dbByVendor = new Map();
  for (const r of dbRows.rows) {
    const key = r.entity_name;
    dbByVendor.set(key, (dbByVendor.get(key) ?? 0) + Number(r.cents));
  }

  const dbTradeShowTotal = [...dbByVendor.values()].reduce((a,b) => a+b, 0);
  console.log(`\nDB Trade Show total Q1 2026: $${(dbTradeShowTotal/100).toFixed(2)}`);

  // ── 3. DB: rows containing 'trade show' in description/entity_name ───────
  const tsText = await client.query(`
    SELECT
      n.entity_name,
      n.description,
      n.month_key,
      SUM(n.amount) AS cents,
      COALESCE(vch.channel, vc.channel, 'Unclassified') AS channel
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND (
        n.entity_name  ILIKE '%trade show%'
        OR n.description ILIKE '%trade show%'
      )
    GROUP BY n.entity_name, n.description, n.month_key, COALESCE(vch.channel, vc.channel, 'Unclassified')
    ORDER BY n.month_key, n.entity_name
  `);
  console.log('\n=== DB rows with "trade show" in name/memo (any channel) ===');
  console.table(tsText.rows.map(r => ({
    entity_name: r.entity_name.slice(0,50),
    month: r.month_key,
    channel: r.channel,
    dollars: (Number(r.cents)/100).toFixed(2),
    description: (r.description ?? '').slice(0,60)
  })));
  const tsTextTotal = tsText.rows.reduce((s,r) => s + Number(r.cents), 0);
  console.log(`Total "trade show" text rows Q1 2026: $${(tsTextTotal/100).toFixed(2)}`);

  // ── 4. Cross-check: vendors in Excel but channel ≠ Trade Show in DB ──────
  // (Excel vendor list extracted separately)
  const excelVendors = [
    "Eleventh & Gather","BestBuy - US","Trevor Macon","Walgreens","Hotel-Misc (US)",
    "Delta Air Lines","Gregory Wu DMD","Gary Long Ramp","Allie Hafliger Ramp",
    "Jake Weber Ramp","United Airlines","Jana Macon Ramp","Shahrzad Nadizadeh Ramp",
    "American Airlines","Southwest Airlines","Guestrs Hotel","Ashleigh Culpepper Ramp",
    "Julia Duncan Ramp","Trade Show Planners Ll","Suzanne Henderson Ramp",
    "Travis Grawey Ramp","Halle Eicher Ramp","Brandon Savage Ramp","Marvin Brown Ramp",
    "Victoria Lane Ramp","Tyler McComas Ramp","Restaurant-Misc","Katie May Ramp",
    "trpts.me","Kennedy kennedy.dalsing@curvedental Ramp","Clinton","Albertsons Market",
    "Fry's Food Stores","Harry & David","Society","Payless Foods","Publix",
    "Vendor-Misc (US)","McCormick Place","Table Covers","Hudson News","Camryn Banks Ramp",
    "Shahrzad Nadizadeh Ramp","Vail Wine Shop & Tasting Room","Boston","wsdot",
    "Brandon Cluff Ramp","Squeezed","Trysta Napper Ramp","COLORADO CONVETION CENTER",
    "Jackson Lettich Ramp","Evolve","Paradies Lagardere - CLT","Piroshky Piroshky",
    "Slate Market","3269 Sat Stars Of San","Your Business Center","Deseret News",
    "Motown Greatest Hits","Tripadvisor","Amazon Fresh","Evolve By Hudson","oxxo",
    "Duke City Art & Frame","(No vendor — journal/payroll/accrual)","Uber",
    "Hartsfield-Jackson Atlanta International Airport","Sean Gove Ramp",
    "Massachusetts Convention Center Authority","Chantelle Camareno Ramp","ROYAL TAXI",
    "Charleston Co Parking","National Car Rental","Atlanta Airport","The Parking Spot",
    "Premium Parking","Domingo Taxi","SFMTA","Seattle Meter Parking","Lyft",
    "Robin Bowling Ramp","Hertz","Sticker Mule","Smartpress","Parking",
    "Minuteman Press Suwanee A Division of Diversified Printing Solutions Inc.",
    "Dr. Scott Leune","UMKC Dental Alumni","Oregon Convention Center",
    "EFFECTIVE DENTISTRY","MidwestDental","KAESER BLAIR INCORPORATED","Exhibits South",
    "Freeman","Smile Source","Metro Denver Dental Society","Hinman Dental Society",
    "Washington State Denta","Trade Show Planners Ll","Seattle Convention Center",
    "Sodexo Live!","JW Marriott Camelback Inn","Jack Nadel International",
    "Fern Expo","Florida Dental","Tory Burch",
    "Massachusetts Convention Center Authority","Amazon.com - US","Maritz Global Events",
    "Opportunityretreiv","Chicago Dental Society","OPTEL TECHNOLOGY LLC",
    "OfficeSignCompany","Displays2go"
  ];
  const uniqueExcelVendors = [...new Set(excelVendors)];

  // Find vendors in DB that are Trade Show but NOT in Excel
  const dbOnlyVendors = [];
  for (const [vendor, cents] of dbByVendor) {
    if (!uniqueExcelVendors.includes(vendor)) {
      dbOnlyVendors.push({ vendor, dollars: (cents/100).toFixed(2) });
    }
  }
  if (dbOnlyVendors.length) {
    console.log('\n=== In DB as Trade Show but NOT in Excel vendor list ===');
    console.table(dbOnlyVendors);
    console.log('Sum DB-only:', dbOnlyVendors.reduce((s,r)=>s+parseFloat(r.dollars),0).toFixed(2));
  } else {
    console.log('\nNo DB Trade Show vendors missing from Excel.');
  }

  // ── 5. Amount comparison per vendor (DB vs Excel raw values) ─────────────
  // We can only compare per-vendor totals; Excel has per-row, DB aggregates across months
  console.log('\n=== Summary ===');
  console.log(`DB Trade Show Q1 2026:   $${(dbTradeShowTotal/100).toFixed(2)}`);
  console.log(`Difference (DB - Excel): $${((dbTradeShowTotal/100) - 472367.9).toFixed(2)}`);

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
