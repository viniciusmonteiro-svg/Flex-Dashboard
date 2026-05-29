import sys, json
sys.stdout.reconfigure(encoding='utf-8')
import openpyxl
from collections import defaultdict

wb = openpyxl.load_workbook(r'C:\Users\vmmon\Downloads\Untitled spreadsheet (8).xlsx', data_only=True)
ws = wb['Sheet1']
rows = list(ws.iter_rows(values_only=True))
header = rows[0]
QUARTERS = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026']
q_col = {h: i for i, h in enumerate(header) if h in QUARTERS}
ch_col = header.index('Marketing Channel')

channels = set()
channel_q_totals = defaultdict(lambda: defaultdict(float))
channel_vendor_q = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))

for r in rows[1:]:
    vendor  = r[0]
    channel = r[ch_col]
    if not channel:
        continue
    channels.add(channel)
    for q, i in q_col.items():
        val = r[i]
        if val is not None:
            try:
                v = float(val)
                channel_q_totals[channel][q] += v
                if vendor:
                    channel_vendor_q[channel][vendor][q] += v
            except Exception:
                pass

print('Channels:', sorted(channels))
print()
print(f"{'Channel':<35} {'Q1 2025':>12} {'Q2 2025':>12} {'Q3 2025':>12} {'Q4 2025':>12} {'Q1 2026':>12} {'TOTAL':>12}")
print('-' * 107)
grand = defaultdict(float)
for ch in sorted(channel_q_totals):
    row_vals = [channel_q_totals[ch].get(q, 0) for q in QUARTERS]
    total = sum(row_vals)
    for q, v in zip(QUARTERS, row_vals):
        grand[q] += v
    print(f"{ch:<35} " + " ".join(f"{v:>12,.0f}" for v in row_vals) + f" {total:>12,.0f}")
print('-' * 107)
grand_vals = [grand[q] for q in QUARTERS]
print(f"{'TOTAL':<35} " + " ".join(f"{v:>12,.0f}" for v in grand_vals) + f" {sum(grand_vals):>12,.0f}")

# Save for use in builder
out = {
    'channel_q_totals': {ch: dict(qmap) for ch, qmap in channel_q_totals.items()},
    'channel_vendor_q': {
        ch: {
            vendor: dict(qmap)
            for vendor, qmap in vmap.items()
        }
        for ch, vmap in channel_vendor_q.items()
    },
    'quarters': QUARTERS,
    'channels': sorted(channels),
}
with open('scripts/excel-data.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2)
print('\nWritten: scripts/excel-data.json')
