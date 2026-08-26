import { describe, expect, it } from 'vitest';
import { scalarOf } from './evidence.js';
import { makeFixture, Q1, Q2, FULL_YEAR } from './fixture.js';
import {
  revenueByCategory,
  revenueMonthlySeries,
  revenueTotal,
  revenueTrend,
} from './revenue.js';

const ds = makeFixture();

describe('revenue_total', () => {
  it('sums every transaction in the period', () => {
    // 400 + 1,000 + 100 + 500 + 300 + 200 = 2,500.
    expect(scalarOf(revenueTotal.run({ ...Q1 }, ds))).toBe(2_500);
  });

  it('restricts to a single category when asked', () => {
    // Only txn-01 (400) and txn-04 (500) are dining in Q1.
    expect(scalarOf(revenueTotal.run({ ...Q1, category: 'dining' }, ds))).toBe(900);
  });

  it('includes the whole of the final day', () => {
    // txn-06 is dated 2024-03-31, the `to` bound itself. A period that resolved `to` to
    // midnight would drop it and quietly report 2,300.
    const withLastDay = scalarOf(revenueTotal.run({ ...Q1 }, ds));
    const withoutLastDay = scalarOf(revenueTotal.run({ from: Q1.from, to: '2024-03-30' }, ds));
    expect(withLastDay - withoutLastDay).toBe(200);
  });

  it('cites exactly the transactions it summed', () => {
    const e = revenueTotal.run({ ...Q1, category: 'dining' }, ds);
    expect(e.rowIds).toEqual(['txn-01', 'txn-04']);
    expect(e.rowCount).toBe(2);
    expect(e.unit).toBe('usd');
  });

  it('returns zero for a period with no transactions rather than failing', () => {
    // Emptiness is a fact, not an error: "we took nothing in that week" is a real answer.
    expect(scalarOf(revenueTotal.run({ from: '2024-07-01', to: '2024-07-31' }, ds))).toBe(0);
  });

  it('rejects an inverted period', () => {
    expect(() => revenueTotal.run({ from: '2024-06-30', to: '2024-04-01' }, ds)).toThrow(
      /is after/,
    );
  });
});

describe('revenue_by_category', () => {
  it('groups and orders by value, largest first', () => {
    const e = revenueByCategory.run({ ...Q1 }, ds);
    expect(e.value).toEqual({
      kind: 'series',
      points: [
        { label: 'dues', n: 1_000 },
        { label: 'dining', n: 900 },
        { label: 'pro-shop', n: 300 },
        { label: 'lessons', n: 200 },
        { label: 'bar', n: 100 },
      ],
    });
  });

  it('reconciles exactly with revenue_total over the same period', () => {
    // The two tools share one filter, and this is the assertion that keeps them honest: a
    // breakdown that does not add up to the headline is how a finance committee loses trust.
    const e = revenueByCategory.run({ ...FULL_YEAR }, ds);
    const summed =
      e.value.kind === 'series' ? e.value.points.reduce((s, p) => s + p.n, 0) : NaN;
    expect(summed).toBe(scalarOf(revenueTotal.run({ ...FULL_YEAR }, ds)));
    expect(summed).toBe(6_790);
  });
});

describe('revenue_trend', () => {
  it('compares a quarter with the equal-length quarter before it', () => {
    // Q2 2024 and Q1 2024 are both 91 days (leap year), so Q2's preceding window is exactly
    // Q1: (2,750 - 2,500) / 2,500 = +10%.
    expect(scalarOf(revenueTrend.run({ ...Q2 }, ds))).toBe(10);
  });

  it('applies the category filter to both windows', () => {
    // Dining: Q2 1,100 against Q1 900 => +22.22%.
    expect(scalarOf(revenueTrend.run({ ...Q2, category: 'dining' }, ds))).toBe(22.22);
  });

  it('cites both windows, not just the current one', () => {
    const e = revenueTrend.run({ ...Q2, category: 'dining' }, ds);
    expect(e.rowIds.sort()).toEqual(['txn-01', 'txn-04', 'txn-07', 'txn-08']);
    expect(e.unit).toBe('percent');
  });

  it('refuses rather than inventing a change from a zero baseline', () => {
    // Nothing precedes Q1 in this dataset, so the honest answer is that the question has no
    // answer - not 0%, not "infinite growth".
    expect(() => revenueTrend.run({ ...Q1 }, ds)).toThrow(/undefined/);
  });
});

describe('revenue_monthly_series', () => {
  it('buckets by calendar month, oldest first', () => {
    expect(revenueMonthlySeries.run({ ...Q1 }, ds).value).toEqual({
      kind: 'series',
      points: [
        { label: '2024-01', n: 400 },
        { label: '2024-02', n: 1_100 },
        { label: '2024-03', n: 1_000 },
      ],
    });
  });

  it('reports an empty month as zero instead of omitting it', () => {
    // July earned nothing. A sparse series would render as a gap, which a reader takes to
    // mean "data missing" - a materially different claim from "no revenue".
    expect(revenueMonthlySeries.run({ from: '2024-06-01', to: '2024-08-31' }, ds).value).toEqual({
      kind: 'series',
      points: [
        { label: '2024-06', n: 500 },
        { label: '2024-07', n: 0 },
        { label: '2024-08', n: 700 },
      ],
    });
  });
});
