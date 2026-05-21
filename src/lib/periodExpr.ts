/**
 * Shared SQL period-expression helpers.
 *
 * Both the channel-costs and vendor-classifications APIs need to build
 * the same SQL expressions for grouping/filtering by accounting period
 * or transaction date. Centralising them here prevents drift.
 *
 * All expressions alias netsuite_actuals as "n".
 */

export type PeriodType = 'accounting' | 'transaction';

/**
 * Returns the SQL expression that derives a "YYYY-MM" period string from
 * each netsuite_actuals row, depending on the chosen period_type.
 *
 * accounting (default):
 *   COALESCE(n.accounting_period, n.month_key)
 *   → uses the NetSuite-booked accounting period; falls back to the
 *     filename-derived month when accounting_period is NULL (old files).
 *
 * transaction:
 *   COALESCE(TO_CHAR(n.transaction_date, 'YYYY-MM'), n.month_key)
 *   → uses the calendar month of the actual transaction date; falls back
 *     to month_key when transaction_date is NULL.
 */
export function buildPeriodExpr(periodType: PeriodType | string): string {
  if (periodType === 'transaction') {
    return `COALESCE(TO_CHAR(n.transaction_date, 'YYYY-MM'), n.month_key)`;
  }
  return `COALESCE(n.accounting_period, n.month_key)`;
}

/**
 * Same as buildPeriodExpr but without the "n." table alias —
 * used in queries that reference netsuite_actuals directly (no alias).
 */
export function buildPeriodExprUnaliased(periodType: PeriodType | string): string {
  if (periodType === 'transaction') {
    return `COALESCE(TO_CHAR(transaction_date, 'YYYY-MM'), month_key)`;
  }
  return `COALESCE(accounting_period, month_key)`;
}
