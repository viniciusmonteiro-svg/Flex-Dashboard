/**
 * Detailed reconciliation: Excel Trade Show vendors vs DB Trade Show vendors
 * Identifies amounts that exist in one source but not the other.
 */
import pkg from 'pg';
const { Client } = pkg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

// Excel data: vendor → total Q1 2026 amount (from openpyxl read, all integers)
const excelRows = [
  ["Eleventh & Gather", 535], ["BestBuy - US", 970], ["Trevor Macon", 778],
  ["Walgreens", 112], ["Hotel-Misc (US)", 27049], ["Delta Air Lines", 20051],
  ["Gregory Wu DMD", 11770], ["Gary Long Ramp", 2776], ["Allie Hafliger Ramp", 565],
  ["Jake Weber Ramp", 2081], ["United Airlines", 2457], ["Jana Macon Ramp", 3172],
  ["Shahrzad Nadizadeh Ramp", 1042], ["American Airlines", 2683],
  ["Southwest Airlines", 1935], ["Guestrs Hotel", 4438],
  ["Ashleigh Culpepper Ramp", 1324], ["Julia Duncan Ramp", 1426],
  ["Trevor Macon", 2368], ["Trade Show Planners Ll", 2115],
  ["Suzanne Henderson Ramp", 2003], ["Travis Grawey Ramp", 1764],
  ["Halle Eicher Ramp", 227], ["Brandon Savage Ramp", 1237],
  ["Marvin Brown Ramp", 58], ["Victoria Lane Ramp", 94],
  ["Tyler McComas Ramp", 867], ["Restaurant-Misc", 106],
  ["Katie May Ramp", 692], ["trpts.me", 192],
  ["Kennedy kennedy.dalsing@curvedental Ramp", 243], ["Clinton", 68],
  ["Albertsons Market", 20], ["Fry's Food Stores", 14],
  ["Restaurant-Misc", 18518], ["Hotel-Misc (US)", 692],
  ["Julia Duncan Ramp", 441], ["Gary Long Ramp", 346],
  ["Trevor Macon", 893], ["Harry & David", 296],
  ["Gregory Wu DMD", 459], ["Victoria Lane Ramp", 230],
  ["Marvin Brown Ramp", 188], ["Society", 461], ["Payless Foods", 370],
  ["Publix", 19], ["Vendor-Misc (US)", 32], ["McCormick Place", 88],
  ["Table Covers", 188], ["Hudson News", 93], ["Camryn Banks Ramp", 140],
  ["Shahrzad Nadizadeh Ramp", 70], ["Vail Wine Shop & Tasting Room", 115],
  ["Kennedy kennedy.dalsing@curvedental Ramp", 103], ["Boston", 34],
  ["wsdot", 63], ["Brandon Cluff Ramp", 61], ["Squeezed", 57],
  ["Trysta Napper Ramp", 22], ["COLORADO CONVETION CENTER", 46],
  ["Jackson Lettich Ramp", 43], ["Evolve", 22],
  ["Paradies Lagardere - CLT", 18], ["Piroshky Piroshky", 18],
  ["Slate Market", 17], ["3269 Sat Stars Of San", 13],
  ["Your Business Center", 11], ["Deseret News", 9],
  ["Motown Greatest Hits", 8], ["Tripadvisor", 7], ["Amazon Fresh", 6],
  ["Evolve By Hudson", 6], ["oxxo", 4], ["Duke City Art & Frame", 3],
  ["(No vendor — journal/payroll/accrual)", -170], ["Uber", 1974],
  ["Hartsfield-Jackson Atlanta International Airport", 610],
  ["Gregory Wu DMD", 589], ["Gary Long Ramp", 339], ["Sean Gove Ramp", 90],
  ["Massachusetts Convention Center Authority", 970], ["Trevor Macon", 613],
  ["Julia Duncan Ramp", 193], ["Chantelle Camareno Ramp", 68],
  ["Shahrzad Nadizadeh Ramp", 187], ["ROYAL TAXI", 288],
  ["Charleston Co Parking", 136], ["National Car Rental", 99],
  ["Atlanta Airport", 120], ["Ashleigh Culpepper Ramp", 106],
  ["Marvin Brown Ramp", 97], ["Jana Macon Ramp", 51],
  ["Hotel-Misc (US)", 60], ["The Parking Spot", 86],
  ["Trysta Napper Ramp", 68], ["Camryn Banks Ramp", 48],
  ["Jackson Lettich Ramp", 47], ["Premium Parking", 29],
  ["Brandon Cluff Ramp", 22], ["Domingo Taxi", 20], ["SFMTA", 3],
  ["Seattle Meter Parking", 3], ["Lyft", 79], ["Robin Bowling Ramp", 148],
  ["National Car Rental", 432], ["Vendor-Misc (US)", 475],
  ["Trysta Napper Ramp", 88], ["Marvin Brown Ramp", 148],
  ["Hertz", 345], ["Trevor Macon", 296], ["Victoria Lane Ramp", 45],
  ["Kennedy kennedy.dalsing@curvedental Ramp", 187],
  ["Ashleigh Culpepper Ramp", 95], ["Camryn Banks Ramp", 90],
  ["Gregory Wu DMD", 67], ["Brandon Cluff Ramp", 66],
  ["Jackson Lettich Ramp", 55], ["Jana Macon Ramp", 47],
  ["Clinton", 12], ["Trevor Macon", 21120], ["Gregory Wu DMD", 20000],
  ["Sticker Mule", 192], ["Smartpress", 4767], ["Parking", 11],
  ["Minuteman Press Suwanee A Division of Diversified Printing Solutions Inc.", 1657],
  ["Dr. Scott Leune", 20832], ["UMKC Dental Alumni", 1500],
  ["Oregon Convention Center", 1166], ["EFFECTIVE DENTISTRY", 1000],
  ["COLORADO CONVETION CENTER", 436], ["MidwestDental", 600],
  ["Robin Bowling Ramp", 25],
  ["(No vendor — journal/payroll/accrual)", 36964],
  ["KAESER BLAIR INCORPORATED", 83421], ["Exhibits South", 25520],
  ["Freeman", 17172], ["Dr. Scott Leune", 10416], ["Smile Source", 1000],
  ["Metro Denver Dental Society", 1500], ["Hinman Dental Society", 9600],
  ["Washington State Denta", 8470], ["Trade Show Planners Ll", 4230],
  ["Seattle Convention Center", 8043], ["Sodexo Live!", 7615],
  ["JW Marriott Camelback Inn", 7361], ["McCormick Place", 5622],
  ["Jack Nadel International", 6992], ["Restaurant-Misc", 6169],
  ["Fern Expo", 1795], ["Florida Dental", 3199], ["Tory Burch", 1027],
  ["Massachusetts Convention Center Authority", 245], ["Amazon.com - US", 943],
  ["Maritz Global Events", 1345], ["Opportunityretreiv", 1225],
  ["Chicago Dental Society", 1196], ["OPTEL TECHNOLOGY LLC", 800],
  ["Table Covers", 577], ["Sticker Mule", 296], ["OfficeSignCompany", 293],
  ["Displays2go", 196], ["(No vendor — journal/payroll/accrual)", 14707],
  ["Tory Burch", 262],
];

// Aggregate Excel by vendor (sum duplicates)
const excelByVendor = new Map();
for (const [v, amt] of excelRows) {
  excelByVendor.set(v, (excelByVendor.get(v) ?? 0) + amt);
}
const excelTotal = [...excelByVendor.values()].reduce((a,b)=>a+b,0);
console.log(`Excel total (integer sum): $${excelTotal.toFixed(2)}`);

async function main() {
  await client.connect();

  // Get DB Trade Show for Q1 2026 at the vendor level (summed across months)
  const dbRows = await client.query(`
    SELECT
      n.entity_name,
      SUM(n.amount) AS cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') = 'Trade Show'
    GROUP BY n.entity_name
    ORDER BY SUM(n.amount) DESC
  `);

  const dbByVendor = new Map();
  for (const r of dbRows.rows) {
    dbByVendor.set(r.entity_name, Number(r.cents));
  }
  const dbTotal = [...dbByVendor.values()].reduce((a,b)=>a+b,0);
  console.log(`DB Trade Show Q1 2026:    $${(dbTotal/100).toFixed(2)}`);

  // Also get UNCLASSIFIED rows that have "trade show" in description/entity
  const unclassTs = await client.query(`
    SELECT
      n.entity_name,
      n.description,
      n.month_key,
      SUM(n.amount) AS cents
    FROM netsuite_actuals n
    LEFT JOIN vendor_classifications vc
           ON vc.financial_row = n.financial_row AND vc.entity_name = n.entity_name
    LEFT JOIN vendor_classification_history vch
           ON vch.financial_row = n.financial_row AND vch.entity_name = n.entity_name
          AND vch.month_key = n.month_key
    WHERE n.month_key IN ('2026-01','2026-02','2026-03')
      AND COALESCE(vch.channel, vc.channel, 'Unclassified') = 'Unclassified'
      AND (n.entity_name ILIKE '%trade show%' OR n.description ILIKE '%trade show%')
    GROUP BY n.entity_name, n.description, n.month_key
    ORDER BY SUM(n.amount) DESC
  `);

  if (unclassTs.rows.length) {
    console.log('\n=== Unclassified rows with "trade show" text ===');
    console.table(unclassTs.rows.map(r => ({
      entity: r.entity_name.slice(0,55),
      month: r.month_key,
      dollars: (Number(r.cents)/100).toFixed(2),
      desc: (r.description??'').slice(0,50)
    })));
    const uTotal = unclassTs.rows.reduce((s,r)=>s+Number(r.cents),0);
    console.log(`Unclassified "trade show" total: $${(uTotal/100).toFixed(2)}`);
    console.log(`If added to Trade Show: $${((dbTotal+uTotal)/100).toFixed(2)}`);
  }

  // Per-vendor diff: Excel vs DB
  console.log('\n=== Per-vendor differences (Excel integer vs DB exact) ===');
  const allVendors = new Set([...excelByVendor.keys(), ...dbByVendor.keys()]);
  const diffs = [];
  for (const v of allVendors) {
    const excelAmt = excelByVendor.get(v) ?? 0;
    const dbAmt    = (dbByVendor.get(v) ?? 0) / 100;
    const diff     = dbAmt - excelAmt;
    if (Math.abs(diff) > 0.005) {
      diffs.push({ vendor: v.slice(0,55), excel: excelAmt.toFixed(2), db: dbAmt.toFixed(2), diff: diff.toFixed(2) });
    }
  }
  diffs.sort((a,b) => Math.abs(parseFloat(b.diff)) - Math.abs(parseFloat(a.diff)));
  console.table(diffs);
  const netDiff = diffs.reduce((s,r)=>s+parseFloat(r.diff),0);
  console.log(`Net difference (sum of per-vendor diffs): $${netDiff.toFixed(2)}`);

  await client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
