import type { ClubDataset, Member, MembershipCategory } from '../domain/types.js';

/**
 * Deterministic, explainable churn risk.
 *
 * ## Why this is not a language-model job
 *
 * A churn score decides where a club spends retention effort and, eventually, who gets a
 * phone call from the GM. It must be reproducible on Tuesday and Thursday, defensible to a
 * board committee, and decomposable when a member disputes it. Language models are none of
 * those things. So the score is arithmetic — auditable, unit-tested, versioned — and the
 * model's only role is to put it into a sentence.
 *
 * That division is the single most useful thing I have learned shipping AI features: decide
 * what genuinely needs a model, and refuse to use one everywhere else. It is also cheaper,
 * faster, and the part that keeps working when the provider has an incident.
 *
 * ## Design
 *
 * Each signal contributes points to a 0-100 risk score, and every contribution carries the
 * human-readable reason that produced it. Baselines are *per member* rather than club-wide:
 * a Social member who visits twice a month has not disengaged, and comparing them to a Full
 * Golf member's cadence would generate noise that erodes trust in the whole feed.
 */

export const CHURN_MODEL_VERSION = '1.2.0';

export interface Contribution {
  /** Short label for the UI. */
  signal: string;
  /** Signed points added to the risk score. Negative values are protective. */
  points: number;
  /** Plain-English justification, shown verbatim to the user. */
  detail: string;
}

export interface ChurnAssessment {
  memberId: string;
  modelVersion: string;
  /** 0-100. Higher is worse. */
  score: number;
  band: 'low' | 'watch' | 'elevated' | 'critical';
  contributions: Contribution[];
  /** ISO date the assessment was computed against. */
  asOf: string;
}

const DAY = 86_400_000;

/** Expected minimum visits per 90 days, by category. Under-use is category-relative. */
const CADENCE_FLOOR: Record<MembershipCategory, number> = {
  'full-golf': 18,
  social: 6,
  'junior-executive': 8,
  corporate: 4,
  'non-resident': 2,
};

/** Facilities that represent the core entitlement of each category. */
const CORE_FACILITY: Partial<Record<MembershipCategory, string>> = {
  'full-golf': 'golf-course',
};

function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(a) - Date.parse(b)) / DAY);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function assessChurn(
  member: Member,
  ds: ClubDataset,
  asOf: string = ds.club.dataTo,
): ChurnAssessment {
  const asOfMs = Date.parse(asOf);
  const windowStart = asOfMs - 90 * DAY;
  const baselineStart = asOfMs - 455 * DAY; // prior ~12 months before the recent window
  const baselineEnd = windowStart;

  const visits = ds.visits.filter((v) => v.memberId === member.id);
  const recentVisits = visits.filter((v) => {
    const t = Date.parse(v.at);
    return t >= windowStart && t <= asOfMs;
  });
  const baselineVisits = visits.filter((v) => {
    const t = Date.parse(v.at);
    return t >= baselineStart && t < baselineEnd;
  });

  const contributions: Contribution[] = [];

  // ── Signal 1: visit cadence against the member's own history ────────────────────
  // Baseline is normalised to a comparable 90-day rate so the comparison is like-for-like.
  const baselineDays = Math.max(1, (baselineEnd - baselineStart) / DAY);
  const baselineRate = (baselineVisits.length / baselineDays) * 90;
  if (baselineRate >= 3) {
    const change = (recentVisits.length - baselineRate) / baselineRate;
    if (change <= -0.3) {
      const points = clamp(Math.round(-change * 45), 0, 34);
      contributions.push({
        signal: 'Visit cadence falling',
        points,
        detail: `${recentVisits.length} visits in the last 90 days against a personal baseline of ${baselineRate.toFixed(
          1,
        )} — down ${Math.round(-change * 100)}%.`,
      });
    } else if (change >= 0.25) {
      contributions.push({
        signal: 'Visit cadence rising',
        points: -6,
        detail: `Visits up ${Math.round(change * 100)}% on this member's own baseline.`,
      });
    }
  }

  // ── Signal 2: absolute under-use relative to what the category entitles ─────────
  const floor = CADENCE_FLOOR[member.category];
  if (recentVisits.length < floor * 0.5) {
    contributions.push({
      signal: 'Under-using membership',
      points: 14,
      detail: `${recentVisits.length} visits in 90 days; a ${member.category.replace(
        /-/g,
        ' ',
      )} membership typically sees at least ${floor}.`,
    });
  }

  // ── Signal 3: silence ───────────────────────────────────────────────────────────
  const last = visits.reduce<string | null>(
    (acc, v) => (acc === null || Date.parse(v.at) > Date.parse(acc) ? v.at : acc),
    null,
  );
  if (last === null) {
    contributions.push({
      signal: 'Never visited',
      points: 30,
      detail: 'No recorded visit to any facility.',
    });
  } else {
    const quiet = daysBetween(asOf, last);
    if (quiet >= 60) {
      contributions.push({
        signal: 'Extended absence',
        points: clamp(Math.round((quiet - 45) / 4), 0, 26),
        detail: `Last on site ${quiet} days ago.`,
      });
    }
  }

  // ── Signal 4: discretionary spend, the leading indicator ────────────────────────
  // Dues are excluded deliberately: they are contractual and keep posting right up to the
  // resignation letter, which is exactly why dues-only reporting misses churn entirely.
  const spend = ds.transactions.filter(
    (t) => t.memberId === member.id && t.category !== 'dues',
  );
  const recentSpend = spend
    .filter((t) => Date.parse(t.date) >= windowStart && Date.parse(t.date) <= asOfMs)
    .reduce((s, t) => s + t.amount, 0);
  const baseSpendTotal = spend
    .filter((t) => Date.parse(t.date) >= baselineStart && Date.parse(t.date) < baselineEnd)
    .reduce((s, t) => s + t.amount, 0);
  const baseSpend90 = (baseSpendTotal / baselineDays) * 90;
  if (baseSpend90 >= 150) {
    const change = (recentSpend - baseSpend90) / baseSpend90;
    if (change <= -0.35) {
      contributions.push({
        signal: 'Discretionary spend dropping',
        points: clamp(Math.round(-change * 30), 0, 22),
        detail: `$${Math.round(recentSpend)} in the last 90 days against a personal baseline of $${Math.round(
          baseSpend90,
        )}.`,
      });
    }
  }

  // ── Signal 5: core entitlement unused (category fit) ────────────────────────────
  const core = CORE_FACILITY[member.category];
  if (core) {
    const coreVisits = recentVisits.filter((v) => v.facility === core).length;
    if (coreVisits === 0 && recentVisits.length >= 0) {
      contributions.push({
        signal: 'Paying for what they no longer use',
        points: 16,
        detail: `No ${core.replace(/-/g, ' ')} activity in 90 days on a ${member.category.replace(
          /-/g,
          ' ',
        )} membership costing $${member.annualDues.toLocaleString()} a year.`,
      });
    }
  }

  // ── Signal 6: what staff actually heard ─────────────────────────────────────────
  const recentNegative = ds.notes.filter(
    (n) =>
      n.memberId === member.id &&
      n.sentiment === 'negative' &&
      Date.parse(n.date) >= asOfMs - 180 * DAY,
  );
  if (recentNegative.length > 0) {
    contributions.push({
      signal: 'Unresolved friction on record',
      points: clamp(8 + (recentNegative.length - 1) * 5, 8, 18),
      detail: `${recentNegative.length} negative interaction${
        recentNegative.length === 1 ? '' : 's'
      } logged in the last six months.`,
    });
  }

  // ── Signal 7: advocacy is protective ────────────────────────────────────────────
  const guestsBrought = recentVisits.reduce((s, v) => s + v.guests, 0);
  if (guestsBrought >= 4) {
    contributions.push({
      signal: 'Bringing guests',
      points: -9,
      detail: `${guestsBrought} guests hosted in 90 days — members who introduce others rarely leave.`,
    });
  }

  // ── Signal 8: tenure is protective, with diminishing effect ─────────────────────
  const tenureYears = daysBetween(asOf, member.joinedAt) / 365;
  if (tenureYears >= 5) {
    contributions.push({
      signal: 'Long tenure',
      points: -Math.round(clamp(tenureYears - 3, 0, 8)),
      detail: `${tenureYears.toFixed(0)} years of membership.`,
    });
  } else if (tenureYears < 1.5) {
    contributions.push({
      signal: 'Still in the first two years',
      points: 10,
      detail: `Joined ${tenureYears.toFixed(1)} years ago; early-tenure members churn at the highest rate.`,
    });
  }

  const score = clamp(
    Math.round(contributions.reduce((s, c) => s + c.points, 0)),
    0,
    100,
  );

  return {
    memberId: member.id,
    modelVersion: CHURN_MODEL_VERSION,
    score,
    band: score >= 70 ? 'critical' : score >= 45 ? 'elevated' : score >= 25 ? 'watch' : 'low',
    // Heaviest drivers first: the UI shows the top three, and they should be the top three.
    contributions: contributions.sort((a, b) => b.points - a.points),
    asOf,
  };
}
