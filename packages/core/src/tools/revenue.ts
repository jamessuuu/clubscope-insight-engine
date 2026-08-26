import type { ClubDataset, RevenueCategory, Transaction } from '../domain/types.js';
import {
  type AnalysisTool,
  type Evidence,
  makeEvidence,
  type ToolParamSpec,
} from './evidence.js';
import {
  FROM_PARAM,
  isoDate,
  monthKey,
  monthsBetween,
  optionalOneOf,
  percentChange,
  periodOf,
  precedingPeriod,
  REVENUE_CATEGORIES,
  TO_PARAM,
  type Period,
  inPeriod,
} from './common.js';

/**
 * Revenue tools.
 *
 * One shared filter underpins all four so that a total, a breakdown, a trend and a monthly
 * series over the same period always reconcile to the same dollar. Reporting that does not
 * add up is worse than no reporting: it is the thing that makes a finance committee stop
 * believing the dashboard.
 */
function transactionsIn(
  ds: ClubDataset,
  p: Period,
  category: RevenueCategory | undefined,
): Transaction[] {
  return ds.transactions.filter(
    (t) => inPeriod(t.date, p) && (category === undefined || t.category === category),
  );
}

const CATEGORY_PARAM = {
  type: 'enum',
  description:
    'Optional revenue category filter. Omit for all revenue including dues. Use "dues" ' +
    'for contractual subscription income and any other value for discretionary spend.',
  enum: [...REVENUE_CATEGORIES],
  required: false,
} satisfies ToolParamSpec;

function scope(category: RevenueCategory | undefined): string {
  return category === undefined ? 'all revenue categories' : `the "${category}" category`;
}

// ─── revenue_total ──────────────────────────────────────────────────────────────────

export interface RevenueTotalParams {
  from: string;
  to: string;
  category?: RevenueCategory;
}

export const revenueTotal: AnalysisTool<RevenueTotalParams> = {
  name: 'revenue_total',
  version: '1.0.0',
  kind: 'read',
  description:
    'Total revenue in dollars over an inclusive date period, optionally restricted to one ' +
    'revenue category. Use for "how much did we take in", "what was F&B revenue last ' +
    'quarter", or any single headline money figure. Returns one scalar in USD.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
    category: CATEGORY_PARAM,
  },

  run(params: RevenueTotalParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');
    const category = optionalOneOf(params.category, 'category', REVENUE_CATEGORIES);

    const rows = transactionsIn(ds, periodOf(from, to), category);
    const total = rows.reduce((sum, t) => sum + t.amount, 0);

    return makeEvidence({
      tool: revenueTotal.name,
      version: revenueTotal.version,
      params: { from, to, category },
      value: { kind: 'scalar', n: total },
      unit: 'usd',
      method:
        `Summed the amount of every transaction dated between ${from} and ${to} inclusive, ` +
        `across ${scope(category)}. ${rows.length} transactions contributed.`,
      rowIds: rows.map((t) => t.id),
    });
  },
};

// ─── revenue_by_category ────────────────────────────────────────────────────────────

export interface RevenueByCategoryParams {
  from: string;
  to: string;
}

export const revenueByCategory: AnalysisTool<RevenueByCategoryParams> = {
  name: 'revenue_by_category',
  version: '1.0.0',
  kind: 'read',
  description:
    'Revenue broken down by category (dues, dining, bar, events, pro-shop, guest-fees, ' +
    'lessons) over an inclusive date period, largest first. Use when the question is about ' +
    'revenue mix, which lines are carrying the club, or where money is coming from. ' +
    'Returns a series, not a single number.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
  },

  run(params: RevenueByCategoryParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');

    const rows = transactionsIn(ds, periodOf(from, to), undefined);

    const totals = new Map<RevenueCategory, number>();
    for (const t of rows) totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);

    // Sorted by value, then by name. The tie-break is not cosmetic: without a total order
    // two runs could emit the same numbers in a different sequence, and the verifier's
    // equality check on recomputed evidence would flap for no real reason.
    const points = [...totals.entries()]
      .map(([label, n]) => ({ label, n }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

    return makeEvidence({
      tool: revenueByCategory.name,
      version: revenueByCategory.version,
      params: { from, to },
      value: { kind: 'series', points },
      unit: 'usd',
      method:
        `Grouped every transaction dated between ${from} and ${to} inclusive by revenue ` +
        `category and summed the amounts, ordered largest first. ${rows.length} ` +
        `transactions across ${points.length} categories.`,
      rowIds: rows.map((t) => t.id),
    });
  },
};

// ─── revenue_trend ──────────────────────────────────────────────────────────────────

export interface RevenueTrendParams {
  from: string;
  to: string;
  category?: RevenueCategory;
}

export const revenueTrend: AnalysisTool<RevenueTrendParams> = {
  name: 'revenue_trend',
  version: '1.0.0',
  kind: 'read',
  description:
    'Percent change in revenue between a period and the equal-length period immediately ' +
    'before it (a 90-day window is compared with the preceding 90 days). Optionally ' +
    'restricted to one category. Use for "is revenue up or down", "how does this quarter ' +
    'compare", or any growth question. Returns one scalar in percentage points, negative ' +
    'for a decline. Fails if the preceding period had no revenue, because percent change ' +
    'from zero is undefined.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
    category: CATEGORY_PARAM,
  },

  run(params: RevenueTrendParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');
    const category = optionalOneOf(params.category, 'category', REVENUE_CATEGORIES);

    const current = periodOf(from, to);
    const previous = precedingPeriod(current);

    const currentRows = transactionsIn(ds, current, category);
    const previousRows = transactionsIn(ds, previous, category);
    const currentTotal = currentRows.reduce((s, t) => s + t.amount, 0);
    const previousTotal = previousRows.reduce((s, t) => s + t.amount, 0);

    const change = percentChange(currentTotal, previousTotal);

    return makeEvidence({
      tool: revenueTrend.name,
      version: revenueTrend.version,
      params: { from, to, category },
      value: { kind: 'scalar', n: change },
      unit: 'percent',
      method:
        `Compared revenue of $${currentTotal.toLocaleString('en-US')} between ${from} and ` +
        `${to} against $${previousTotal.toLocaleString('en-US')} in the equal-length period ` +
        `immediately before it, across ${scope(category)}. Both windows span the same ` +
        `number of days, so the comparison is like-for-like.`,
      // Both windows are cited: a trend figure that only shows you half its inputs is not
      // auditable, and "down 40%" is exactly the claim a member of staff will contest.
      rowIds: [...currentRows.map((t) => t.id), ...previousRows.map((t) => t.id)],
    });
  },
};

// ─── revenue_monthly_series ─────────────────────────────────────────────────────────

export interface RevenueMonthlySeriesParams {
  from: string;
  to: string;
  category?: RevenueCategory;
}

export const revenueMonthlySeries: AnalysisTool<RevenueMonthlySeriesParams> = {
  name: 'revenue_monthly_series',
  version: '1.0.0',
  kind: 'read',
  description:
    'Revenue per calendar month across a period, oldest month first, optionally restricted ' +
    'to one category. Every month in the range is present even when it earned nothing. Use ' +
    'for seasonality, month-on-month shape, or anything that should be charted over time. ' +
    'Returns a series, not a single number.',
  params: {
    from: FROM_PARAM,
    to: TO_PARAM,
    category: CATEGORY_PARAM,
  },

  run(params: RevenueMonthlySeriesParams, ds: ClubDataset): Evidence {
    const from = isoDate(params.from, 'from');
    const to = isoDate(params.to, 'to');
    const category = optionalOneOf(params.category, 'category', REVENUE_CATEGORIES);

    const p = periodOf(from, to);
    const rows = transactionsIn(ds, p, category);

    const totals = new Map<string, number>();
    for (const t of rows) {
      const key = monthKey(t.date);
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }

    // Dense, not sparse. A gap in a chart reads as "we have no data for March"; a zero
    // reads as "March earned nothing". They are different facts and a club GM will act
    // differently on each, so the series always spans the full requested range.
    const points = monthsBetween(p).map((label) => ({ label, n: totals.get(label) ?? 0 }));

    return makeEvidence({
      tool: revenueMonthlySeries.name,
      version: revenueMonthlySeries.version,
      params: { from, to, category },
      value: { kind: 'series', points },
      unit: 'usd',
      method:
        `Bucketed every transaction dated between ${from} and ${to} inclusive into calendar ` +
        `months and summed the amounts, across ${scope(category)}. Months with no revenue ` +
        `are reported as zero rather than omitted. ${points.length} months, ${rows.length} ` +
        `transactions.`,
      rowIds: rows.map((t) => t.id),
    });
  },
};
