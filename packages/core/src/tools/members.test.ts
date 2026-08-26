import { describe, expect, it } from 'vitest';
import { CHURN_MODEL_VERSION } from '../scoring/churn.js';
import { scalarOf } from './evidence.js';
import { FULL_YEAR, M1, M7, M8, M9, makeFixture } from './fixture.js';
import {
  churnCohortSize,
  cohortRetention,
  duesAtRisk,
  memberChurnScore,
  memberCount,
} from './members.js';

const ds = makeFixture();

describe('member_count', () => {
  it('counts the whole roll when unfiltered', () => {
    expect(scalarOf(memberCount.run({}, ds))).toBe(9);
  });

  it('filters by status', () => {
    // 9 on the roll, less one resigned (m3) and one suspended (m6).
    expect(scalarOf(memberCount.run({ status: 'active' }, ds))).toBe(7);
  });

  it('filters by category', () => {
    // m1, m3 and m7 are full-golf, regardless of status.
    expect(scalarOf(memberCount.run({ category: 'full-golf' }, ds))).toBe(3);
  });

  it('applies status and category together', () => {
    // Active social members: m2, m5, m8.
    expect(scalarOf(memberCount.run({ status: 'active', category: 'social' }, ds))).toBe(3);
  });

  it('cites the member rows it counted', () => {
    const e = memberCount.run({ status: 'active', category: 'social' }, ds);
    expect(e.rowIds).toEqual(['mem-002', 'mem-005', 'mem-008']);
    expect(e.rowCount).toBe(3);
    expect(e.unit).toBe('count');
  });

  it('rejects a status that is not a real status', () => {
    expect(() => memberCount.run({ status: 'lapsed' as never }, ds)).toThrow(/must be one of/);
  });
});

/**
 * Band expectations are pinned to churn model v1.2.0 and to the fixture, which is built so
 * that exactly one active member sits in each of low / watch / critical and the rest in
 * elevated. If the scoring model changes, these should fail: a cohort tool silently
 * returning a different number of at-risk members is precisely the change a reviewer needs
 * to see, not one to be absorbed by a self-recomputing assertion.
 */
describe('churn_cohort_size', () => {
  it('pins the fixture bands the cohort thresholds are measured against', () => {
    expect(CHURN_MODEL_VERSION).toBe('1.2.0');
    expect(scalarOf(memberChurnScore.run({ memberId: M8 }, ds))).toBe(0); // low
    expect(scalarOf(memberChurnScore.run({ memberId: M9 }, ds))).toBe(29); // watch
    expect(scalarOf(memberChurnScore.run({ memberId: M1 }, ds))).toBe(53); // elevated
    expect(scalarOf(memberChurnScore.run({ memberId: M7 }, ds))).toBe(78); // critical
  });

  it('counts active members at or above each band', () => {
    // Active members score: m8 low, m9 watch, m1/m2/m4/m5 elevated, m7 critical.
    expect(scalarOf(churnCohortSize.run({ band: 'watch' }, ds))).toBe(6);
    expect(scalarOf(churnCohortSize.run({ band: 'elevated' }, ds))).toBe(5);
    expect(scalarOf(churnCohortSize.run({ band: 'critical' }, ds))).toBe(1);
  });

  it('is monotonic as the threshold rises', () => {
    const at = (band: 'watch' | 'elevated' | 'critical') =>
      scalarOf(churnCohortSize.run({ band }, ds));
    expect(at('watch')).toBeGreaterThanOrEqual(at('elevated'));
    expect(at('elevated')).toBeGreaterThanOrEqual(at('critical'));
  });

  it('insists the caller names a band rather than guessing one', () => {
    // "How many members are at risk?" is ambiguous until a threshold is chosen. Picking one
    // silently would put a number on screen that answers a question nobody asked.
    expect(() => churnCohortSize.run({} as never, ds)).toThrow(/required/);
    expect(() => duesAtRisk.run({} as never, ds)).toThrow(/required/);
  });

  it('excludes members who have already resigned', () => {
    // m3 scores 76 - critical - but has resigned. Counting them would inflate every
    // retention number the club then acts on: their departure is history, not risk.
    const e = churnCohortSize.run({ band: 'critical' }, ds);
    expect(e.rowIds).toEqual([M7]);
    expect(e.rowIds).not.toContain('mem-003');
  });
});

describe('dues_at_risk', () => {
  it('sums the annual dues of the at-risk cohort', () => {
    // watch+: m1 12,000 + m2 3,000 + m4 8,000 + m5 3,000 + m7 12,000 + m9 8,000 = 46,000.
    expect(scalarOf(duesAtRisk.run({ band: 'watch' }, ds))).toBe(46_000);
    // elevated+ drops m9 (8,000).
    expect(scalarOf(duesAtRisk.run({ band: 'elevated' }, ds))).toBe(38_000);
    // critical is m7 alone.
    expect(scalarOf(duesAtRisk.run({ band: 'critical' }, ds))).toBe(12_000);
  });

  it('reports dollars, and cites the members carrying them', () => {
    const e = duesAtRisk.run({ band: 'critical' }, ds);
    expect(e.unit).toBe('usd');
    expect(e.rowIds).toEqual([M7]);
    expect(e.rowCount).toBe(1);
  });

  it('agrees with churn_cohort_size on who is in the cohort', () => {
    // The two tools answer the same question in different units; if their member sets ever
    // diverge, one of the two headline retention figures on the dashboard is wrong.
    for (const band of ['watch', 'elevated', 'critical'] as const) {
      expect(duesAtRisk.run({ band }, ds).rowIds).toEqual(
        churnCohortSize.run({ band }, ds).rowIds,
      );
    }
  });
});

describe('member_churn_score', () => {
  it('returns the model score for one member', () => {
    expect(scalarOf(memberChurnScore.run({ memberId: M1 }, ds))).toBe(53);
    expect(memberChurnScore.run({ memberId: M1 }, ds).unit).toBe('score');
  });

  it('names the heaviest drivers in its method, for the receipt drawer', () => {
    const e = memberChurnScore.run({ memberId: M7 }, ds);
    expect(e.method).toContain('M-007');
    expect(e.method).toContain('critical');
    expect(e.method).toMatch(/Heaviest drivers:/);
  });

  it('refuses an unknown member instead of returning zero', () => {
    expect(() => memberChurnScore.run({ memberId: 'mem-999' }, ds)).toThrow(/no member/);
  });
});

describe('cohort_retention', () => {
  it('measures the share of a joining cohort still active at the dataset end', () => {
    // Joined during 2024: m2, m4, m6, m7. Still active: m2, m4, m7 => 3/4 = 75%.
    expect(scalarOf(cohortRetention.run({ ...FULL_YEAR }, ds))).toBe(75);
  });

  it('cites the whole cohort, not just the survivors', () => {
    const e = cohortRetention.run({ ...FULL_YEAR }, ds);
    expect(e.rowIds).toEqual(['mem-002', 'mem-004', 'mem-006', 'mem-007']);
    expect(e.rowCount).toBe(4);
    expect(e.unit).toBe('percent');
  });

  it('refuses a period nobody joined in', () => {
    expect(() => cohortRetention.run({ from: '2023-01-01', to: '2023-12-31' }, ds)).toThrow(
      /undefined/,
    );
  });
});
