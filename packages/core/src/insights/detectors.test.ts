import { describe, expect, it } from 'vitest';
import { getDataset, PLANTED_ANOMALIES } from '../data/index.js';
import type {
  ClubDataset,
  ClubEvent,
  EventRegistration,
  Member,
  RevenueCategory,
  Transaction,
  Visit,
} from '../domain/types.js';
import { parseFigure, roundsTo } from '../verify/numbers.js';
import { DETECTORS, type Detector } from './detectors.js';
import { formatCount, formatPercent, formatUsd, narratableDetectors } from './narrate.js';
import { detectInsights } from './index.js';
import type { DetectorContext } from './types.js';

/**
 * Detector tests.
 *
 * ## Both directions, always
 *
 * Every detector is tested twice: once on a fixture built so the condition is present, and
 * once on a fixture built so it is absent. Only the first half is the interesting-looking
 * test, and only the second half proves anything — a detector that fires unconditionally
 * passes every positive test ever written and is worse than no detector at all, because it
 * teaches its reader to ignore the feed.
 *
 * ## Fixtures are hand-built, not generated
 *
 * Each fixture below carries the smallest number of rows that makes its condition true, with
 * the arithmetic written out in the comment above it. A test that computes its own
 * expectation from the dataset proves only that the code agrees with itself.
 *
 * The club window matches the generated dataset's, because the detectors derive every
 * comparison window from `dataFrom`/`dataTo`. Pinning the fixture window to the same bounds
 * keeps the dates in these tests and the dates in a real run the same dates.
 */

// ─── Fixture construction ───────────────────────────────────────────────────────────

const DATA_FROM = '2024-09-01';
const DATA_TO = '2026-08-31';

/** The context every detector is exercised with, matching `detectInsights`'s own default. */
const CTX: DetectorContext = { now: DATA_TO };

/**
 * The windows the detectors derive from `DATA_TO`, restated here as constants.
 *
 * Written out rather than imported so that a change to the windowing logic breaks these
 * tests instead of silently moving them with it — the dates a detector compares are part of
 * what is under test, not an implementation detail the test should inherit.
 */
const CURRENT = { from: '2026-03-01', to: '2026-08-31' }; // six complete months to the end
const PRECEDING = { from: '2025-08-29', to: '2026-02-28' }; // the equal window before it
const YEAR_AGO = { from: '2025-03-01', to: '2025-08-31' }; // the same six months last year

function blank(over: Partial<ClubDataset> = {}): ClubDataset {
  return {
    club: {
      name: 'Fixture Club',
      kind: 'country',
      city: 'Nowhere',
      foundedYear: 1900,
      dataFrom: DATA_FROM,
      dataTo: DATA_TO,
    },
    members: [],
    transactions: [],
    visits: [],
    events: [],
    registrations: [],
    notes: [],
    ...over,
  };
}

function member(id: string, over: Partial<Member> = {}): Member {
  return {
    id,
    memberNo: id.toUpperCase(),
    firstName: 'Test',
    lastName: id,
    email: `${id}@example.test`,
    category: 'social',
    status: 'active',
    joinedAt: '2015-01-01',
    householdSize: 1,
    ageBand: '35-49',
    annualDues: 5_000,
    homeCity: 'Nowhere',
    joinedVia: 'waitlist',
    ...over,
  };
}

function txn(
  id: string,
  date: string,
  category: RevenueCategory,
  amount: number,
  memberId = 'm-1',
): Transaction {
  return { id, memberId, date, category, amount };
}

function visit(id: string, at: string, memberId = 'm-1'): Visit {
  return { id, memberId, at, facility: 'tennis-court', guests: 0, durationMin: 60 };
}

function event(id: string, date: string): ClubEvent {
  return { id, name: id, date, kind: 'social', capacity: 50 };
}

/** `attended` of `total` registrations against one event. */
function registrations(eventId: string, total: number, attended: number): EventRegistration[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `${eventId}-reg-${i}`,
    eventId,
    memberId: 'm-1',
    attended: i < attended,
    guests: 0,
  }));
}

/** Fails loudly rather than skipping: a renamed detector must break its own test. */
function detector(id: string): Detector {
  const found = DETECTORS.find((d) => d.id === id);
  if (!found) throw new Error(`no detector registered with id "${id}"`);
  return found;
}

// ─── The register itself ────────────────────────────────────────────────────────────

describe('the detector register', () => {
  it('has no duplicate detector ids', () => {
    expect(new Set(DETECTORS.map((d) => d.id)).size).toBe(DETECTORS.length);
  });

  it('can narrate every detector it registers', () => {
    // A detector without a template throws at narration time, which would surface as a
    // crashing feed rather than as a missing card. Catching it here keeps that impossible.
    expect(narratableDetectors()).toEqual([...DETECTORS.map((d) => d.id)].sort());
  });

  it('produces a silent feed on a dataset with nothing in it', () => {
    // The headline behavioural claim: quiet data, quiet feed. Every detector must decline,
    // and the tools it calls must be allowed to refuse without taking the run down with them.
    expect(detectInsights(blank(), CTX)).toEqual([]);
  });
});

// ─── 1. revenue-category-decline ────────────────────────────────────────────────────

describe('revenue-category-decline', () => {
  const id = 'revenue-category-decline';

  it('fires when a category falls against both the preceding window and last year', () => {
    // Dining: $60k now against $100k in the preceding window (-40%) and $100k in the same
    // months last year (-40%). Both comparisons agree, and $60k clears the $25k floor.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-05-15', 'dining', 60_000),
        txn('t-prev', '2025-12-15', 'dining', 100_000),
        txn('t-year', '2025-05-15', 'dining', 100_000),
      ],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe('critical');
    expect(insight?.headline).toContain('Dining');
    expect(insight?.narrative).toMatch(/\[\[e:[a-f0-9]{16}\|-40%\]\]/);
  });

  it('stays quiet when the fall is inside ordinary half-year variance', () => {
    // $60k against $62k is -3.2%, comfortably inside the band a price list can move on
    // its own, and last year is flat. Nothing to report.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-05-15', 'dining', 60_000),
        txn('t-prev', '2025-12-15', 'dining', 62_000),
        txn('t-year', '2025-05-15', 'dining', 60_000),
      ],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });

  it('refuses to fire on a fall the preceding window shows but last year does not', () => {
    // The seasonality guard, isolated. $40k now against $100k before it is a 60% collapse
    // by the preceding-window measure — and the same months last year took $40k too, so the
    // "collapse" is the calendar. A detector without corroboration fires here every year.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-05-15', 'dining', 40_000),
        txn('t-prev', '2025-12-15', 'dining', 100_000),
        txn('t-year', '2025-05-15', 'dining', 40_000),
      ],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── 2. facility-underutilisation ───────────────────────────────────────────────────

// 2025-06-11 is a Wednesday in UTC, so 08:00 lands inside the weekday-morning window and
// 18:00 lands outside it on the hour rather than on the day.
const WEEKDAY_MORNING = '2025-06-11T08:00:00.000Z';
const WEEKDAY_EVENING = '2025-06-11T18:00:00.000Z';

function courtVisits(morning: number, evening: number): Visit[] {
  return [
    ...Array.from({ length: morning }, (_, i) => visit(`v-am-${i}`, WEEKDAY_MORNING)),
    ...Array.from({ length: evening }, (_, i) => visit(`v-pm-${i}`, WEEKDAY_EVENING)),
  ];
}

describe('facility-underutilisation', () => {
  const id = 'facility-underutilisation';

  it('fires when a staffed block carries almost none of a facility\'s traffic', () => {
    // 6 of 600 court visits fall in the weekday-morning block: a 1% share, against a 5%
    // threshold, on a facility well past the 500-visit floor.
    const ds = blank({ members: [member('m-1')], visits: courtVisits(6, 594) });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe('elevated');
    expect(insight?.narrative).toContain('tennis courts');
  });

  it('stays quiet when the block is carrying a reasonable share', () => {
    // 60 of 600 is 10% — below a quarter of the hours, but not the near-zero this detector
    // is built to find, and programming a block that already works is not a recommendation.
    const ds = blank({ members: [member('m-1')], visits: courtVisits(60, 540) });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });

  it('stays quiet on a facility with too little traffic to have a share', () => {
    // 1 of 100. The share is lower than the fixture above, and the volume floor still
    // refuses it: a percentage decided by single rows is not a finding.
    const ds = blank({ members: [member('m-1')], visits: courtVisits(1, 99) });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── 3. churn-cohort-exposure ───────────────────────────────────────────────────────

/**
 * A member the churn model scores into the elevated band, by construction.
 *
 * Never visited (+30), under-using the membership (+14) and inside the first two years
 * (+10) sums to 54, which is elevated but short of critical. Social category is chosen
 * deliberately: it has no core-facility entitlement, so the "paying for what they no longer
 * use" signal stays out and the arithmetic above is the whole score.
 */
function atRiskMember(id: string): Member {
  return member(id, { category: 'social', joinedAt: '2025-09-01', annualDues: 20_000 });
}

describe('churn-cohort-exposure', () => {
  const id = 'churn-cohort-exposure';

  it('fires when at-risk dues are a material share of dues income', () => {
    // Three members at $20k each is $60k of exposure against $1M of dues billed in the
    // trailing twelve months — 6%, above the 3% bar and below the 8% severity step.
    const ds = blank({
      members: [atRiskMember('m-1'), atRiskMember('m-2'), atRiskMember('m-3')],
      transactions: [txn('t-dues', '2026-01-15', 'dues', 1_000_000)],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe('elevated');
    expect(insight?.kind).toBe('churn');
  });

  it('escalates to critical when the exposure outruns budgeted attrition', () => {
    // The same cohort against $500k of dues income is 12% — past the point a club's budget
    // absorbs as ordinary attrition. Severity moves with the money, not the headcount.
    const ds = blank({
      members: [atRiskMember('m-1'), atRiskMember('m-2'), atRiskMember('m-3')],
      transactions: [txn('t-dues', '2026-01-15', 'dues', 500_000)],
    });

    expect(detector(id).run(ds, CTX)?.severity).toBe('critical');
  });

  it('stays quiet when nobody scores into the band', () => {
    // Long tenure and four visits inside the scoring window: the model returns a protective
    // score, the cohort is empty, and there is nothing to say.
    const ds = blank({
      members: [member('m-1', { joinedAt: '2015-01-01' })],
      transactions: [txn('t-dues', '2026-01-15', 'dues', 1_000_000)],
      visits: [
        visit('v-1', '2026-06-15T10:00:00.000Z'),
        visit('v-2', '2026-07-15T10:00:00.000Z'),
        visit('v-3', '2026-08-05T10:00:00.000Z'),
        visit('v-4', '2026-08-20T10:00:00.000Z'),
      ],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── 4. weak-joiner-cohort ──────────────────────────────────────────────────────────

function cohort(prefix: string, joinedAt: string, size: number, retained: number): Member[] {
  return Array.from({ length: size }, (_, i) =>
    member(`${prefix}-${i}`, {
      joinedAt,
      ...(i < retained
        ? { status: 'active' as const }
        : { status: 'resigned' as const, resignedAt: '2026-01-15' }),
    }),
  );
}

describe('weak-joiner-cohort', () => {
  const id = 'weak-joiner-cohort';

  it('fires on a quarter retaining far below the club as a whole', () => {
    // Q1 2025: 12 of 25 still active (48%). Q2 2025: 25 of 25 (100%). Club-wide across the
    // window: 37 of 50 (74%). The gap of 26 points clears both the 7-point bar and the
    // 15-point severity step, and both cohorts clear the 20-member floor.
    const ds = blank({
      members: [...cohort('q1', '2025-02-01', 25, 12), ...cohort('q2', '2025-05-01', 25, 25)],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe('critical');
    expect(insight?.headline).toContain('Q1 2025');
  });

  it('stays quiet when every cohort retains at about the same rate', () => {
    // 24 of 25 against a club-wide 49 of 50: a two-point gap, which is one resignation.
    const ds = blank({
      members: [...cohort('q1', '2025-02-01', 25, 24), ...cohort('q2', '2025-05-01', 25, 25)],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });

  it('refuses to report a small cohort as a finding', () => {
    // 1 of 5 retained in Q1 is a 20% rate and a 60-point gap — and it is five people. The
    // size floor is what stops the arithmetic of small numbers becoming a story about
    // member services.
    const ds = blank({
      members: [...cohort('q1', '2025-02-01', 5, 1), ...cohort('q2', '2025-05-01', 25, 25)],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── 5. guest-fee-surge ─────────────────────────────────────────────────────────────

describe('guest-fee-surge', () => {
  const id = 'guest-fee-surge';

  it('fires when the season runs well ahead of the same season last year', () => {
    // $80k this June-to-August against $40k last: a doubling, on a base past the $20k floor.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-07-15', 'guest-fees', 80_000),
        txn('t-year', '2025-07-15', 'guest-fees', 40_000),
      ],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    // Revenue arriving is not an incident, however large. Severity is reserved for loss.
    expect(insight?.severity).toBe('informational');
  });

  it('stays quiet on an ordinary good summer', () => {
    // $44k against $40k is 10% — inside what weather and one busy member-guest weekend do.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-07-15', 'guest-fees', 44_000),
        txn('t-year', '2025-07-15', 'guest-fees', 40_000),
      ],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── 6. event-attendance-drop ───────────────────────────────────────────────────────

describe('event-attendance-drop', () => {
  const id = 'event-attendance-drop';

  it('fires when registrations stop converting into attendance', () => {
    // 5 of 10 in the current window against 9 of 10 before it: a 40-point fall.
    const ds = blank({
      members: [member('m-1')],
      events: [event('e-now', '2026-05-01'), event('e-prev', '2025-12-01')],
      registrations: [...registrations('e-now', 10, 5), ...registrations('e-prev', 10, 9)],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe('critical');
  });

  it('stays quiet when turnout holds', () => {
    const ds = blank({
      members: [member('m-1')],
      events: [event('e-now', '2026-05-01'), event('e-prev', '2025-12-01')],
      registrations: [...registrations('e-now', 10, 9), ...registrations('e-prev', 10, 9)],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── 7. spend-per-member-drift ──────────────────────────────────────────────────────

describe('spend-per-member-drift', () => {
  const id = 'spend-per-member-drift';

  it('fires, and treats a fall as the retention signal it is', () => {
    // One active member, so the average is the spend: $500 this half-year against $1,000 in
    // the same half-year last year. A 50% fall, and the divisor is identical in both windows.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-05-01', 'dining', 500),
        txn('t-year', '2025-05-01', 'dining', 1_000),
      ],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe('elevated');
    expect(insight?.headline).toContain('falling');
  });

  it('fires on a rise, but files it as information rather than a warning', () => {
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-05-01', 'dining', 2_000),
        txn('t-year', '2025-05-01', 'dining', 1_000),
      ],
    });

    const insight = detector(id).run(ds, CTX);

    expect(insight?.severity).toBe('informational');
    expect(insight?.headline).toContain('climbing');
  });

  it('stays quiet on a move a price list could explain', () => {
    // $960 against $1,000 is 4% — under the eight percent that separates behaviour from
    // the club's own pricing.
    const ds = blank({
      members: [member('m-1')],
      transactions: [
        txn('t-now', '2026-05-01', 'dining', 960),
        txn('t-year', '2025-05-01', 'dining', 1_000),
      ],
    });

    expect(detector(id).run(ds, CTX)).toBeNull();
  });
});

// ─── The formatter, against the gate that judges it ─────────────────────────────────

describe('figure formatting', () => {
  /**
   * The invariant the whole narration layer rests on.
   *
   * The verifier accepts a written figure when the true value lies inside the interval that
   * rounds to it. If a formatter can produce a figure outside that interval, then a
   * perfectly honest insight gets blocked and the temptation is to widen the verifier —
   * which would delete the only mechanism that catches an actually invented number. So the
   * formatters are tested directly against `parseFigure`/`roundsTo`, on the awkward values:
   * magnitude boundaries, exact halves, negatives and repeating decimals.
   */
  const cases: Array<[number, (n: number) => string]> = [
    [0, formatUsd],
    [1, formatUsd],
    [999.49, formatUsd],
    [2_893.44, formatUsd],
    [9_999.5, formatUsd],
    [10_000, formatUsd],
    [10_500, formatUsd],
    [151_375, formatUsd],
    [249_917, formatUsd],
    [999_999, formatUsd],
    [1_000_000, formatUsd],
    [2_931_060, formatUsd],
    [1_241_880, formatUsd],
    [-83_028, formatUsd],
    [-4.35, formatPercent],
    [1.9375, formatPercent],
    [9.95, formatPercent],
    [-21.5, formatPercent],
    [-24.94, formatPercent],
    [70.97, formatPercent],
    [79.45, formatPercent],
    [100, formatPercent],
    [0, formatCount],
    [90, formatCount],
    [4_646, formatCount],
    [1_234_567, formatCount],
  ];

  it.each(cases)('writes %d as a figure the verifier accepts', (value, format) => {
    const written = format(value);
    const parsed = parseFigure(written);

    expect(parsed, `"${written}" is not a parseable figure`).not.toBeNull();
    expect(roundsTo(parsed!, value), `"${written}" does not round-trip to ${value}`).toBe(true);
  });
});

// ─── The feed, end to end, on the real dataset ──────────────────────────────────────

describe('detectInsights over the generated dataset', () => {
  it('returns a feed in which every insight is verified', () => {
    const insights = detectInsights(getDataset());

    expect(insights.length).toBeGreaterThan(0);

    // The headline guarantee of the whole system, asserted rather than assumed. Reported
    // per insight so a failure names the detector and the exact check that failed, instead
    // of saying only that something somewhere disagreed with its own evidence.
    for (const insight of insights) {
      const failures = insight.verification.checks.filter((c) => c.outcome !== 'match');
      expect(
        failures,
        `${insight.detector} produced unverifiable figures: ${JSON.stringify(failures)}`,
      ).toEqual([]);
      expect(insight.verification.status).toBe('verified');
      expect(insight.verification.groundedRate).toBe(1);
      expect(insight.verification.undeclaredCount).toBe(0);
    }
  });

  it('cites at least one figure per insight, and every citation resolves to attached evidence', () => {
    for (const insight of detectInsights(getDataset())) {
      const attached = new Set(insight.evidence.map((e) => e.id));
      const cited = [...insight.narrative.matchAll(/\[\[e:([a-f0-9]{16})\|/g)].map((m) => m[1]);

      // A citation pointing at evidence the card does not carry would render as a receipt
      // the reader cannot open — verified in the abstract, unauditable on the screen.
      expect(cited.length).toBeGreaterThan(0);
      for (const id of cited) expect(attached.has(id)).toBe(true);
    }
  });

  it('orders the feed by severity', () => {
    const rank = { critical: 0, elevated: 1, informational: 2 } as const;
    const ranks = detectInsights(getDataset()).map((i) => rank[i.severity]);

    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('finds every planted anomaly, and attributes each to the right detector', () => {
    // Attribution, not merely detection. The generator plants each anomaly in a different
    // facility, category and window precisely so that "something fired" is not good enough:
    // the fired detector has to be the one whose question the anomaly answers, and the card
    // has to name the thing that actually moved.
    const expected: Record<string, { detector: string; mentions: string }> = {
      'dining-decline-2026': { detector: 'revenue-category-decline', mentions: 'Dining' },
      'tennis-weekday-mornings': { detector: 'facility-underutilisation', mentions: 'tennis' },
      'q1-2025-joiner-cohort': { detector: 'weak-joiner-cohort', mentions: 'Q1 2025' },
      'guest-fee-surge-2026': { detector: 'guest-fee-surge', mentions: 'Guest fee' },
    };

    const insights = detectInsights(getDataset());

    for (const anomaly of PLANTED_ANOMALIES) {
      const target = expected[anomaly.id];
      // An anomaly added to the generator with no detector mapped to it fails here rather
      // than quietly going unfound, which is the failure mode this test exists to prevent.
      expect(target, `no detector mapped to planted anomaly "${anomaly.id}"`).toBeDefined();

      const match = insights.find((i) => i.detector === target.detector);
      expect(match, `"${anomaly.title}" was not detected by ${target.detector}`).toBeDefined();
      expect(`${match!.headline} ${match!.narrative}`).toContain(target.mentions);
    }
  });

  it('is deterministic across runs', () => {
    // Insight ids are hashed from the evidence ids behind them, and evidence ids are hashed
    // from tool, version and params. Identical output across two runs is therefore a real
    // check that nothing in the path reached for the wall clock, a random value or object
    // iteration order — the three ways a "deterministic" pipeline usually is not.
    const digest = (): Array<[string, string, string, string]> =>
      detectInsights(getDataset()).map((i) => [i.id, i.headline, i.narrative, i.severity]);

    expect(digest()).toEqual(digest());
  });

  it('does not report an anomaly before its cause exists', () => {
    // The same guarantee as the empty-dataset case, one layer up and on real data. Anchored
    // to mid-2025 — before the chef leaves, before the reciprocal arrangement, before the Q1
    // cohort has had time to resign — the anomaly-driven detectors must all decline. What
    // survives is only the two standing conditions, which were true on that date as well.
    const early = detectInsights(getDataset(), { now: '2025-06-30' });
    const fired = new Set(early.map((i) => i.detector));

    expect(early.length).toBeLessThan(detectInsights(getDataset()).length);
    expect(fired.has('revenue-category-decline')).toBe(false);
    expect(fired.has('guest-fee-surge')).toBe(false);
    expect(fired.has('weak-joiner-cohort')).toBe(false);
    for (const insight of early) expect(insight.verification.status).toBe('verified');
  });
});
