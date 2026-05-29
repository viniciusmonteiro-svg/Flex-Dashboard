const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatCurrency(cents: number): string {
  return usdFormatter.format(cents / 100);
}

export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

export function formatPercent(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatMonth(monthKey: string): string {
  // 'YYYY-MM' → 'Jan 2026'
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function formatMonthShort(monthKey: string): string {
  // 'YYYY-MM' → 'Jan 26'
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function formatDateTime(ts: string): string {
  // '2026-05-21T15:45:00Z' → 'May 21, 2026 3:45 PM'
  const d = new Date(ts);
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${datePart} ${timePart}`;
}
