import { describe, expect, it } from 'vitest';
import type { ClubDataset, Member } from '../domain/types.js';
import { assessChurn } from '../scoring/churn.js';
import {
  DEFAULT_SEED,
  generateDataset,
  getDataset,
  PLANTED_ANOMALIES,
  resetDatasetCache,
} from './index.js';

/**
 * Tests for the synthetic dataset.
 *
 * The determinism and referential-integrity cases are table stakes. The section that
 * actually earns its place is `planted anomalies`: each of the four claims the demo makes is
 * re-derived here from the raw rows with an independent computation, so the fixture cannot
 * quietly stop supporting the story the product tells about it. A demo that asserts "dining
 * revenue fell a fifth in February" and a dataset in which that is no longer true is the
 * exact failure mode this whole prototype is arguing against.
 */

// Generated once and shared: generation is pure, every assertion is read-only, and paying
// ~170ms per test case for a dataset that cannot differ would be waste, not isolation.
const ds = getDataset();

const DAY = 86_400_000;

function sum(ns: readonly number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

function withinInclusive(date: string, from: string, to: string): boolean {
  // ISO dates sort lexicographically, so string comparison is exact and needs no parsing.
  return date >= from && date <= to;
}

function revenue(dataset: ClubDataset, category: string, from: string, to: string): number {
  return sum(
    dataset.transactions
      .filter((t) => t.category === category && withinInclusive(t.date, from, to))
      .map((t) => t.amount),
  );
}

function anomaly(id: string): (typeof PLANTED_ANOMALIES)[number] {
  const found = PLANTED_ANOMALIES.find((a) => a.id === id);
  if (found === undefined) throw new Error(`No planted anomaly with id ${id}`);
  return found;
}

function joinedInWindow(m: Member): boolean {
  return withinInclusive(m.joinedAt, ds.club.dataFrom, ds.club.dataTo);
}

function inQ1Cohort(m: Member): boolean {
  return withinInclusive(m.joinedAt, '2025-01-01', '2025-03-31');
}

describe('determinism', () => {
  it('produces byte-identical output for the same seed', () => {
    // Serialised comparison rather than a deep-equal: it catches key *ordering* differences
    // too, which is what would break a recorded assistant transcript or a hash-keyed cache
    // even when the data is semantically identical.
    const a = JSON.stringify(generateDataset(DEFAULT_SEED));
    const b = JSON.stringify(generateDataset(DEFAULT_SEED));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(1_000_000);
  });

  it('produces different data for a different seed', () => {
    const other = generateDataset(DEFAULT_SEED + 1);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(ds));
    // The shape must survive a seed change even though the contents do not - anything else
    // means the generator is fitting the seed rather than the domain.
    expect(other.members).toHaveLength(ds.members.length);
    expect(other.visits.length).toBeGreaterThan(30_000);
    expect(other.transactions.length).toBeGreaterThan(40_000);
  });

  it('memoises so every consumer sees the same rows', () => {
    // Reference equality, not deep equality: the guarantee the grounding story needs is that
    // an eval case, a server component and the verifier are looking at the *same object*,
    // not at two structurally identical copies that could drift apart later.
    const first = getDataset();
    expect(getDataset()).toBe(first);

    resetDatasetCache();
    const rebuilt = getDataset();
    expect(rebuilt).not.toBe(first);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(first));
  });
});

describe('shape and volume', () => {
  it('describes the club the prototype claims to describe', () => {
    expect(ds.club).toEqual({
      name: 'Windermere Hills Country Club',
      kind: 'country',
      city: 'Dallas, Texas',
      foundedYear: 1962,
      dataFrom: '2024-09-01',
      dataTo: '2026-08-31',
    });
  });

  it('lands inside the row budget the analysis layer was designed against', () => {
    expect(ds.members).toHaveLength(420);
    expect(ds.visits.length).toBeGreaterThanOrEqual(35_000);
    expect(ds.visits.length).toBeLessThanOrEqual(60_000);
    expect(ds.transactions.length).toBeGreaterThanOrEqual(45_000);
    expect(ds.transactions.length).toBeLessThanOrEqual(80_000);
    // Three to five events a month across 24 months.
    expect(ds.events.length).toBeGreaterThanOrEqual(24 * 3);
    expect(ds.events.length).toBeLessThanOrEqual(24 * 5 + 8);
  });

  it('carries a realistic membership mix', () => {
    const share = (category: Member['category']): number =>
      ds.members.filter((m) => m.category === category).length / ds.members.length;
    expect(share('full-golf')).toBeCloseTo(0.3, 2);
    expect(share('social')).toBeCloseTo(0.34, 2);
    expect(share('junior-executive')).toBeCloseTo(0.12, 2);
    expect(share('corporate')).toBeCloseTo(0.09, 2);
    expect(share('non-resident')).toBeCloseTo(0.15, 2);
  });

  it('spreads joining across decades, including a legacy tail', () => {
    const years = ds.members.map((m) => Number(m.joinedAt.slice(0, 4)));
    expect(Math.min(...years)).toBeLessThan(1990);
    expect(Math.max(...years)).toBe(2026);
    expect(new Set(years).size).toBeGreaterThan(25);
  });

  it('prices dues by category with genuine per-member variation', () => {
    const golf = ds.members.filter((m) => m.category === 'full-golf').map((m) => m.annualDues);
    const social = ds.members.filter((m) => m.category === 'social').map((m) => m.annualDues);
    expect(Math.min(...golf)).toBeGreaterThan(Math.max(...social));
    // A single flat price per category would make dues revenue trivially decomposable and
    // would hide exactly the legacy-rate drift a membership committee cares about.
    expect(new Set(golf).size).toBeGreaterThan(20);
  });

  it('has no marina at a landlocked country club', () => {
    expect(ds.visits.some((v) => v.facility === 'marina-berth')).toBe(false);
  });
});

describe('referential integrity', () => {
  const memberIds = new Set(ds.members.map((m) => m.id));
  const eventIds = new Set(ds.events.map((e) => e.id));

  it('resolves every member foreign key', () => {
    expect(ds.visits.filter((v) => !memberIds.has(v.memberId))).toHaveLength(0);
    expect(ds.transactions.filter((t) => !memberIds.has(t.memberId))).toHaveLength(0);
    expect(ds.notes.filter((n) => !memberIds.has(n.memberId))).toHaveLength(0);
    expect(ds.registrations.filter((r) => !memberIds.has(r.memberId))).toHaveLength(0);
  });

  it('resolves every event foreign key', () => {
    expect(ds.registrations.filter((r) => !eventIds.has(r.eventId))).toHaveLength(0);
  });

  it('issues unique ids across every table', () => {
    const unique = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;
    expect(unique(ds.members.map((m) => m.id))).toBe(true);
    expect(unique(ds.members.map((m) => m.memberNo))).toBe(true);
    expect(unique(ds.members.map((m) => m.email))).toBe(true);
    expect(unique(ds.visits.map((v) => v.id))).toBe(true);
    expect(unique(ds.transactions.map((t) => t.id))).toBe(true);
    expect(unique(ds.events.map((e) => e.id))).toBe(true);
    expect(unique(ds.registrations.map((r) => r.id))).toBe(true);
    expect(unique(ds.notes.map((n) => n.id))).toBe(true);
  });

  it('registers each member at most once per event', () => {
    const seen = new Set<string>();
    for (const r of ds.registrations) {
      const key = `${r.eventId}:${r.memberId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('keeps registrations inside capacity and attendance below registration', () => {
    const byEvent = new Map<string, { registered: number; attended: number }>();
    for (const r of ds.registrations) {
      const acc = byEvent.get(r.eventId) ?? { registered: 0, attended: 0 };
      acc.registered += 1;
      if (r.attended) acc.attended += 1;
      byEvent.set(r.eventId, acc);
    }
    for (const event of ds.events) {
      const acc = byEvent.get(event.id) ?? { registered: 0, attended: 0 };
      expect(acc.registered).toBeLessThanOrEqual(event.capacity);
      expect(acc.attended).toBeLessThanOrEqual(acc.registered);
    }
    const registered = ds.registrations.length;
    const attended = ds.registrations.filter((r) => r.attended).length;
    expect(attended / registered).toBeGreaterThan(0.7);
    expect(attended / registered).toBeLessThan(0.95);
  });
});

describe('temporal bounds', () => {
  const { dataFrom, dataTo } = ds.club;

  it('keeps every activity row inside the declared window', () => {
    // The assistant is required to refuse questions outside dataFrom..dataTo, so a single
    // row outside it would make an honest refusal look like a bug.
    expect(ds.visits.filter((v) => !withinInclusive(v.at.slice(0, 10), dataFrom, dataTo))).toHaveLength(0);
    expect(ds.transactions.filter((t) => !withinInclusive(t.date, dataFrom, dataTo))).toHaveLength(0);
    expect(ds.events.filter((e) => !withinInclusive(e.date, dataFrom, dataTo))).toHaveLength(0);
    expect(ds.notes.filter((n) => !withinInclusive(n.date, dataFrom, dataTo))).toHaveLength(0);
  });

  it('allows joinedAt to predate the window but never to postdate it', () => {
    // joinedAt is deliberately exempt from the window: tenure reaching back to the 1980s is
    // the point of the field, and clipping it would destroy the strongest protective signal
    // in the churn model.
    expect(ds.members.some((m) => m.joinedAt < dataFrom)).toBe(true);
    expect(ds.members.filter((m) => m.joinedAt > dataTo)).toHaveLength(0);
  });

  it('gives every resigned member a resignedAt inside the window, and nobody else one', () => {
    const resigned = ds.members.filter((m) => m.status === 'resigned');
    expect(resigned.length).toBeGreaterThan(0);
    for (const m of resigned) {
      expect(m.resignedAt).toBeDefined();
      const resignedAt = m.resignedAt ?? '';
      expect(withinInclusive(resignedAt, dataFrom, dataTo)).toBe(true);
      expect(resignedAt >= m.joinedAt).toBe(true);
    }
    for (const m of ds.members.filter((m) => m.status !== 'resigned')) {
      expect(m.resignedAt).toBeUndefined();
    }
  });

  it('stops activity at resignation', () => {
    const byMember = new Map<string, string>();
    for (const v of ds.visits) {
      const current = byMember.get(v.memberId);
      if (current === undefined || v.at > current) byMember.set(v.memberId, v.at);
    }
    for (const m of ds.members.filter((m) => m.status === 'resigned')) {
      const last = byMember.get(m.id);
      if (last === undefined) continue;
      expect(last.slice(0, 10) <= (m.resignedAt ?? '')).toBe(true);
    }
  });

  it('loses roughly eight per cent of the roster a year', () => {
    const resigned = ds.members.filter((m) => m.status === 'resigned').length;
    const annual = resigned / ds.members.length / 2;
    expect(annual).toBeGreaterThan(0.06);
    expect(annual).toBeLessThan(0.1);
  });
});

describe('churn signal quality', () => {
  const visitsByMember = new Map<string, number[]>();
  for (const v of ds.visits) {
    const list = visitsByMember.get(v.memberId) ?? [];
    list.push(Date.parse(v.at));
    visitsByMember.set(v.memberId, list);
  }

  /** Visit count in the `days` before `endMs`, offset back by `skip` days. */
  const countIn = (memberId: string, endMs: number, days: number, skip = 0): number => {
    const to = endMs - skip * DAY;
    const from = to - days * DAY;
    return (visitsByMember.get(memberId) ?? []).filter((t) => t > from && t <= to).length;
  };

  it('gives most resigning members a real pre-resignation decay', () => {
    // Compare the final 90 days before resignation to the 90 days before that, per member,
    // so the comparison is against the member's own baseline exactly as the churn model
    // does it. A club-wide baseline would drown a Social member in Full Golf cadence.
    const resigned = ds.members.filter((m) => m.status === 'resigned' && m.resignedAt !== undefined);
    let declining = 0;
    let assessable = 0;

    for (const m of resigned) {
      const endMs = Date.parse(`${m.resignedAt ?? ''}T00:00:00.000Z`);
      const baseline = countIn(m.id, endMs, 90, 90);
      if (baseline < 4) continue; // too quiet to have anything to decay from
      assessable += 1;
      if (countIn(m.id, endMs, 90) < baseline * 0.7) declining += 1;
    }

    expect(assessable).toBeGreaterThan(20);
    expect(declining / assessable).toBeGreaterThan(0.5);
  });

  it('leaves some resignations with no warning at all', () => {
    // If every departure were telegraphed, a churn model scoring 1.0 recall on this fixture
    // would tell you nothing about how it behaves on a real roster.
    const resigned = ds.members.filter((m) => m.status === 'resigned' && m.resignedAt !== undefined);
    const quiet = resigned.filter((m) => {
      const endMs = Date.parse(`${m.resignedAt ?? ''}T00:00:00.000Z`);
      const baseline = countIn(m.id, endMs, 90, 90);
      return baseline >= 4 && countIn(m.id, endMs, 90) >= baseline * 0.85;
    });
    expect(quiet.length).toBeGreaterThan(3);
  });

  it('leaves active members who look like they are leaving and do not', () => {
    // The false positives. Without them, precision on this fixture would be an artefact.
    const endMs = Date.parse(`${ds.club.dataTo}T00:00:00.000Z`);
    const decayingStayers = ds.members.filter((m) => {
      if (m.status !== 'active') return false;
      const baseline = countIn(m.id, endMs, 90, 90);
      return baseline >= 5 && countIn(m.id, endMs, 90) < baseline * 0.5;
    });
    expect(decayingStayers.length).toBeGreaterThan(8);
  });

  it('produces signals the shipped churn model can actually read', () => {
    // The point of the whole fixture, stated as an assertion.
    //
    // Members are bucketed by an *independent* reading of the raw visit rows - decayed,
    // quiet, or too thin to judge - and then scored by the real model as of the day before
    // they resigned. If the generated decay were cosmetic, the decayed bucket would score
    // like the stayers and every churn demo built on this dataset would be theatre.
    //
    // Note this deliberately does not assert a recall figure. Pushing recall up would mean
    // tuning the data to flatter the model, which is the exact failure this prototype exists
    // to argue against. What it asserts is separation: decayed members score materially
    // above members who stayed, and quiet resignations stay invisible.
    const asOfDayBefore = (m: Member): string =>
      new Date(Date.parse(`${m.resignedAt ?? ''}T00:00:00.000Z`) - DAY).toISOString().slice(0, 10);

    const decayed: number[] = [];
    const quiet: number[] = [];

    for (const m of ds.members.filter((m) => m.status === 'resigned' && (m.resignedAt ?? '') > '2025-03-01')) {
      const endMs = Date.parse(`${m.resignedAt ?? ''}T00:00:00.000Z`);
      const baseline = countIn(m.id, endMs, 90, 90);
      if (baseline < 4) continue;
      const score = assessChurn(m, ds, asOfDayBefore(m)).score;
      if (countIn(m.id, endMs, 90) < baseline * 0.7) decayed.push(score);
      else quiet.push(score);
    }

    const stayers = ds.members
      .filter((m) => m.status === 'active' && m.joinedAt < ds.club.dataFrom)
      .map((m) => assessChurn(m, ds).score);

    const median = (ns: readonly number[]): number => {
      const sorted = [...ns].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const shareAtLeast = (ns: readonly number[], threshold: number): number =>
      ns.filter((n) => n >= threshold).length / ns.length;

    expect(decayed.length).toBeGreaterThan(10);
    expect(quiet.length).toBeGreaterThan(5);

    // Decaying members are visible: most reach at least the 'watch' band.
    expect(median(decayed)).toBeGreaterThanOrEqual(25);
    expect(shareAtLeast(decayed, 25)).toBeGreaterThan(0.5);

    // Members who stayed mostly are not - but some are, so precision is not free either.
    expect(shareAtLeast(stayers, 25)).toBeLessThan(0.3);
    expect(shareAtLeast(stayers, 25)).toBeGreaterThan(0.02);
    expect(median(decayed)).toBeGreaterThan(median(stayers) + 15);

    // And the quiet leavers are genuinely undetectable, which is the honest part.
    expect(shareAtLeast(quiet, 45)).toBeLessThan(0.35);
  });

  it('keeps dues posting right up to the resignation, which is why dues alone miss churn', () => {
    const resignedWithDecay = ds.members.filter((m) => m.status === 'resigned' && (m.resignedAt ?? '') > '2025-06-01');
    const stillBilled = resignedWithDecay.filter((m) => {
      const resignedAt = m.resignedAt ?? '';
      const cutoff = new Date(Date.parse(`${resignedAt}T00:00:00.000Z`) - 45 * DAY).toISOString().slice(0, 10);
      return ds.transactions.some(
        (t) => t.memberId === m.id && t.category === 'dues' && t.date >= cutoff && t.date <= resignedAt,
      );
    });
    expect(stillBilled.length / resignedWithDecay.length).toBeGreaterThan(0.85);
  });
});

describe('planted anomalies', () => {
  it('declares exactly the four anomalies the insight engine is graded on', () => {
    expect(PLANTED_ANOMALIES.map((a) => a.id).sort()).toEqual([
      'dining-decline-2026',
      'guest-fee-surge-2026',
      'q1-2025-joiner-cohort',
      'tennis-weekday-mornings',
    ]);
  });

  it('#1 dining revenue falls about a fifth year on year after the chef leaves', () => {
    // Year-on-year over the same calendar months, not before-versus-after. Dining is
    // strongly seasonal here (November and December carry the year), so a naive
    // Sep-Jan vs Feb-Aug split would report a "decline" that is mostly Christmas ending.
    const before = revenue(ds, 'dining', '2025-02-01', '2025-08-31');
    const after = revenue(ds, 'dining', '2026-02-01', '2026-08-31');
    const change = (after - before) / before;

    const { expected, tolerance } = anomaly('dining-decline-2026').metric;
    expect(change).toBeGreaterThan(expected - tolerance);
    expect(change).toBeLessThan(expected + tolerance);

    // "Sustained", not one bad month: every single month after the departure is below its
    // counterpart a year earlier. This is the property that separates a real regime change
    // from a noisy month, and it is what the insight card claims.
    for (const month of ['02', '03', '04', '05', '06', '07', '08']) {
      const priorYear = revenue(ds, 'dining', `2025-${month}-01`, `2025-${month}-31`);
      const thisYear = revenue(ds, 'dining', `2026-${month}-01`, `2026-${month}-31`);
      expect(thisYear).toBeLessThan(priorYear);
    }

    // The pro shop is the control: it shares the roster, the seasonality and the attrition
    // drag, and has no exposure to the kitchen. Dining must fall materially further, or the
    // finding is just "the club shrank" wearing a chef's hat.
    const proShopChange =
      (revenue(ds, 'pro-shop', '2026-02-01', '2026-08-31') - revenue(ds, 'pro-shop', '2025-02-01', '2025-08-31')) /
      revenue(ds, 'pro-shop', '2025-02-01', '2025-08-31');
    expect(change).toBeLessThan(proShopChange - 0.08);
  });

  it('#1 clusters negative food-and-beverage notes after the departure', () => {
    const foodTalk = /kitchen|dining|chef|menu|food|meal|brunch|grill|wine list|drinks order|mains|cover/i;
    const negative = ds.notes.filter((n) => n.sentiment === 'negative' && foodTalk.test(n.body));

    // Normalised per month, because the "before" period is seventeen months long and the
    // "after" period is seven. Raw counts would understate the step change by half.
    const beforeRate = negative.filter((n) => n.date < '2026-02-01').length / 17;
    const afterRate = negative.filter((n) => n.date >= '2026-02-01').length / 7;

    expect(beforeRate).toBeGreaterThan(0); // the topic existed before, so this is a step, not an invention
    expect(afterRate / beforeRate).toBeGreaterThan(3);

    // The cause is recoverable only from committee minutes - never from a field.
    const minutes = ds.notes.filter((n) => n.channel === 'committee' && /executive chef/i.test(n.body));
    expect(minutes.length).toBeGreaterThanOrEqual(2);
  });

  it('#2 leaves the tennis courts empty on weekday mornings', () => {
    const tennis = ds.visits.filter((v) => v.facility === 'tennis-court');
    expect(tennis.length).toBeGreaterThan(2_000);

    const weekdayMorning = tennis.filter((v) => {
      const at = new Date(v.at);
      const dow = at.getUTCDay();
      return dow >= 1 && dow <= 5 && at.getUTCHours() < 11;
    });
    const share = weekdayMorning.length / tennis.length;

    const { expected, tolerance } = anomaly('tennis-weekday-mornings').metric;
    expect(share).toBeGreaterThan(Math.max(0, expected - tolerance));
    expect(share).toBeLessThan(expected + tolerance);

    // The weekend mornings are busy, which is what makes this a scheduling failure rather
    // than a fact about when people like to play tennis.
    const weekendMorning = tennis.filter((v) => {
      const at = new Date(v.at);
      const dow = at.getUTCDay();
      return (dow === 0 || dow === 6) && at.getUTCHours() < 11;
    });
    expect(weekendMorning.length).toBeGreaterThan(weekdayMorning.length * 8);

    // It holds across the whole window rather than being a seasonal artefact.
    for (const year of ['2025', '2026']) {
      const inYear = tennis.filter((v) => v.at.startsWith(year));
      const morningsInYear = weekdayMorning.filter((v) => v.at.startsWith(year));
      expect(morningsInYear.length / inYear.length).toBeLessThan(0.05);
    }
  });

  it('#3 churns the Q1 2025 joiner cohort at roughly double the rate of other joiners', () => {
    const cohort = ds.members.filter(inQ1Cohort);
    const otherJoiners = ds.members.filter((m) => joinedInWindow(m) && !inQ1Cohort(m));

    // A membership drive, so the intake is visibly larger than a normal quarter.
    expect(cohort.length).toBeGreaterThan(20);
    expect(otherJoiners.length).toBeGreaterThan(20);

    const rate = (group: readonly Member[]): number =>
      group.filter((m) => m.status === 'resigned').length / group.length;
    const ratio = rate(cohort) / rate(otherJoiners);

    const { expected, tolerance } = anomaly('q1-2025-joiner-cohort').metric;
    expect(ratio).toBeGreaterThan(expected - tolerance);
    expect(ratio).toBeLessThan(expected + tolerance);
  });

  it('#3 shows the onboarding failure in first-90-day engagement', () => {
    const first90 = (m: Member): number => {
      const from = Date.parse(`${m.joinedAt}T00:00:00.000Z`);
      const to = from + 90 * DAY;
      return ds.visits.filter((v) => v.memberId === m.id && Date.parse(v.at) >= from && Date.parse(v.at) <= to)
        .length;
    };
    const mean = (ns: readonly number[]): number => sum(ns) / ns.length;

    const cohort = mean(ds.members.filter(inQ1Cohort).map(first90));
    const others = mean(ds.members.filter((m) => joinedInWindow(m) && !inQ1Cohort(m)).map(first90));

    // Less than half the engagement of a normal new member in the window that decides
    // whether a membership sticks. This is the evidence that the failure is onboarding
    // rather than acquisition - the club sold the memberships, then dropped them.
    expect(cohort / others).toBeLessThan(0.7);
    expect(others).toBeGreaterThan(6);

    // And the members said so, in writing.
    const cohortIds = new Set(ds.members.filter(inQ1Cohort).map((m) => m.id));
    const cohortComplaints = ds.notes.filter((n) => cohortIds.has(n.memberId) && n.sentiment === 'negative');
    expect(cohortComplaints.length).toBeGreaterThan(5);
  });

  it('#4 surges guest fees in summer 2026 against the prior summer', () => {
    const before = revenue(ds, 'guest-fees', '2025-06-01', '2025-08-31');
    const after = revenue(ds, 'guest-fees', '2026-06-01', '2026-08-31');
    const change = (after - before) / before;

    const { expected, tolerance } = anomaly('guest-fee-surge-2026').metric;
    expect(change).toBeGreaterThan(expected - tolerance);
    expect(change).toBeLessThan(expected + tolerance);

    // It is a guest phenomenon, not a traffic phenomenon: total visits in the same window
    // did not move anything like as far, so "more members came" is a wrong explanation and
    // an insight that offers it should be marked wrong.
    const visitsIn = (from: string, to: string): number =>
      ds.visits.filter((v) => withinInclusive(v.at.slice(0, 10), from, to)).length;
    const visitChange =
      (visitsIn('2026-06-01', '2026-08-31') - visitsIn('2025-06-01', '2025-08-31')) /
      visitsIn('2025-06-01', '2025-08-31');
    expect(Math.abs(visitChange)).toBeLessThan(0.15);
    expect(change).toBeGreaterThan(visitChange + 0.3);

    // Concentrated in golf and pool, which is how the reciprocal arrangement was written.
    const guestsAt = (facility: string, from: string, to: string): number =>
      sum(
        ds.visits
          .filter((v) => v.facility === facility && withinInclusive(v.at.slice(0, 10), from, to))
          .map((v) => v.guests),
      );
    const golfBefore = guestsAt('golf-course', '2025-06-01', '2025-08-31');
    const golfAfter = guestsAt('golf-course', '2026-06-01', '2026-08-31');
    const tennisBefore = guestsAt('tennis-court', '2025-06-01', '2025-08-31');
    const tennisAfter = guestsAt('tennis-court', '2026-06-01', '2026-08-31');

    expect(golfAfter / golfBefore).toBeGreaterThan(1.3);
    expect(tennisAfter / tennisBefore).toBeLessThan(golfAfter / golfBefore);
  });
});

describe('staff notes', () => {
  it('writes varied prose rather than templated filler', () => {
    expect(ds.notes.length).toBeGreaterThan(600);
    const distinct = new Set(ds.notes.map((n) => n.body));
    // Retrieval quality is meaningless over a corpus of six repeated sentences, and these
    // are shown verbatim to a human, so the variety has to be real.
    expect(distinct.size).toBeGreaterThan(400);
    expect(ds.notes.every((n) => n.body.length > 30)).toBe(true);
  });

  it('carries all three sentiments in believable proportions', () => {
    const share = (sentiment: string): number =>
      ds.notes.filter((n) => n.sentiment === sentiment).length / ds.notes.length;
    expect(share('positive')).toBeGreaterThan(0.15);
    expect(share('neutral')).toBeGreaterThan(0.2);
    expect(share('negative')).toBeGreaterThan(0.15);
  });

  it('never dates a note before the member joined', () => {
    const joinedAt = new Map(ds.members.map((m) => [m.id, m.joinedAt] as const));
    for (const n of ds.notes) {
      const joined = joinedAt.get(n.memberId);
      expect(joined).toBeDefined();
      expect(n.date >= (joined ?? '')).toBe(true);
    }
  });
});
