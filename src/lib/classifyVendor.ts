/**
 * SQL fragments for period-aware vendor classification.
 *
 * Priority for each netsuite_actuals row:
 *   1. vendor_classification_history for that row's specific month_key
 *   2. vendor_classifications (current, as fallback)
 *   3. 'Unclassified'
 *
 * Usage: alias netsuite_actuals as 'n', then embed CLASSIFICATION_JOINS
 * directly after the FROM / JOIN chain. Use CHANNEL_EXPR wherever you
 * need the resolved channel (SELECT, WHERE, GROUP BY, ORDER BY).
 *
 * Example:
 *   SELECT n.financial_row, ${CHANNEL_EXPR} AS channel, SUM(n.amount)
 *   FROM netsuite_actuals n
 *   ${CLASSIFICATION_JOINS}
 *   WHERE ${CHANNEL_EXPR} NOT IN ('Unclassified', 'Do Not Tag (COGS/Non-S&M)')
 *   GROUP BY n.financial_row, ${CHANNEL_EXPR}
 */

/** Two LEFT JOINs resolving the channel for each netsuite_actuals row by month. */
export const CLASSIFICATION_JOINS = `
  LEFT JOIN vendor_classification_history vch
         ON vch.financial_row = n.financial_row
        AND vch.entity_name   = n.entity_name
        AND vch.month_key     = n.month_key
  LEFT JOIN vendor_classifications vc
         ON vc.financial_row  = n.financial_row
        AND vc.entity_name    = n.entity_name`.trim();

/** Resolved channel expression — repeat verbatim in SELECT / WHERE / GROUP BY. */
export const CHANNEL_EXPR = `COALESCE(vch.channel, vc.channel, 'Unclassified')`;
