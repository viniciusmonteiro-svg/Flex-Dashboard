/**
 * Shared SQL building blocks for the multi-layer channel cost calculation.
 *
 * Application order:
 *  1. Raw netsuite_actuals amounts
 *  2. vendor_classifications / vendor_classification_history (CLASSIFICATION_JOINS)
 *  3. intercompany_allocations  ← buildIntercompanyJoin + INTERCOMPANY_AMOUNT_EXPR
 *  4. gl_reclassifications      ← GL_EXCLUSION_CLAUSE
 *  5. department_adjustments    ← applyDepartmentAdjustments() (post-aggregation)
 */

import { query } from '@/db/query';

/**
 * LEFT JOIN intercompany_allocations.
 * Add AFTER CLASSIFICATION_JOINS in the FROM/JOIN chain.
 * periodExpr must be the same PERIOD variable used elsewhere in the query.
 */
export function buildIntercompanyJoin(periodExpr: string): string {
  return `LEFT JOIN intercompany_allocations ia
         ON ia.financial_row = n.financial_row
        AND ia.entity_name   = n.entity_name
        AND (ia.valid_from IS NULL OR ${periodExpr} >= ia.valid_from)
        AND (ia.valid_to   IS NULL OR ${periodExpr} <= ia.valid_to)`;
}

/**
 * Use inside SUM() in place of bare n.amount to apply intercompany %.
 * Requires buildIntercompanyJoin to be present in the FROM clause.
 */
export const INTERCOMPANY_AMOUNT_EXPR =
  `CASE WHEN ia.id IS NOT NULL THEN n.amount * ia.marketing_pct / 100.0 ELSE n.amount END`;

/**
 * Add to WHERE (with AND) to exclude GL accounts fully reclassified out of marketing.
 */
export const GL_EXCLUSION_CLAUSE =
  `n.financial_row NOT IN (SELECT financial_row FROM gl_reclassifications)`;

/**
 * After aggregating to channel totals (dollars), fetch department_adjustments
 * and add the fixed dollar amount to each matching channel.
 *
 * T must have { channel: string; amount: number }.
 */
export async function applyDepartmentAdjustments<T extends { channel: string; amount: number }>(
  rows: T[]
): Promise<T[]> {
  const adjs = await query<{ channel: string; amount: string }>(
    'SELECT channel, amount FROM department_adjustments'
  );
  if (adjs.length === 0) return rows;
  const adjMap = new Map(adjs.map((a) => [a.channel, Number(a.amount) / 100]));
  return rows.map((r) => ({
    ...r,
    amount: r.amount + (adjMap.get(r.channel) ?? 0),
  }));
}
