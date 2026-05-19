function cssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const CHART_TOKENS = {
  get spend() { return cssVar('--color-chart-spend'); },
  get budget() { return cssVar('--color-chart-budget'); },
  get variance() { return cssVar('--color-chart-variance'); },
  get leads() { return cssVar('--color-chart-leads'); },
};
