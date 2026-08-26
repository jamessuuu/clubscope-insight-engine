import { createHash } from 'node:crypto';
import type { ClubDataset, FacilityKind, RevenueCategory } from '../domain/types.js';
import {
  FACILITIES,
  periodOf,
  precedingPeriod,
  REVENUE_CATEGORIES,
  scalarOf,
  TOOL_REGISTRY,
  type Evidence,
} from '../tools/index.js';
import { narrate, type EvidenceByKey, type NarrationFacts } from './narrate.js';
import type {
  DetectorContext,
  Insight,
  InsightKind,
  InsightSeverity,
  SuggestedAction,
} from './types.js';

/**
 * The detectors.
 *
 * ## What a detector is allowed to do
 *
 * Read `insights/types.ts` first — it states the premise. A detector is deterministic code
 * that either fires or does not, for a stated reason. Three rules follow from that, and
 * they are the reason this file looks the way it does:
 *
 * 1. **Numbers come from the tool registry, never from a hand-rolled pass over the rows.**
 *    A detector that filtered `ds.transactions` itself would produce a figure the verifier
 *    cannot recompute, and an insight whose headline number has no receipt is precisely the
 *    thing this architecture exists to make impossible.
 * 2. **Every threshold is a named constant with a written justification.** A bare `-12` in
 *    a condition is an assertion nobody can argue with, which means nobody can tune it and
 *    nobody can defend it to a general manager who disagrees. The constants below are the
 *    product decisions; the code around them is plumbing.
 * 3. **`null` is a first-class answer.** A quiet quarter must produce a quiet feed. A
 *    detector that always finds something is a horoscope.
 *
 * ## Why a detector returns an Insight without its verification
 *
 * `Insight` carries a `VerificationReport`, and a detector has no standing to fill it in:
 * marking your own work verified is not verification. So the return type is the Insight
 * minus that one field, and the gate in `index.ts` attaches the report only after
 * re-running every cited figure through `verifyNarrative`. The type system therefore makes
 * it impossible for a detector to emit a "verified" insight that nothing ever checked.
 *
 * ## Two comparison shapes, chosen per detector rather than globally
 *
 * - *The preceding equal window* answers "is this getting worse right now" fastest, and is
 *   the right shape for a ratio such as attendance rate, which barely moves with the season.
 * - *The same window a year earlier* is the right shape for dollar volumes, because club
 *   revenue is violently seasonal and a preceding-window comparison of summer against winter
 *   will report the calendar as though it were a business event.
 *
 * The revenue-decline detector uses both and requires them to agree before it fires. That
 * corroboration is the difference between a detector and a seasonality alarm.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────────

/** An Insight before the gate has ruled on it. See the note above. */
export type DetectedInsight = Omit<Insight, 'verification'>;

export interface Detector {
  /** Matches `Insight.detector`, so a reviewer can grep from a rendered card to this file. */
  id: string;
  kind: InsightKind;
  /** The question this detector asks, in one line, for the UI index and test failures. */
  question: string;
  run(ds: ClubDataset, ctx: DetectorContext): DetectedInsight | null;
}

// ─── Calendar helpers ───────────────────────────────────────────────────────────────
//
// All UTC, all derived from the dataset rather than from the clock — the same discipline
// `tools/common.ts` explains at length. A detector that read the wall clock would produce a
// different feed on a laptop in Sydney than on a server in Virginia, and the verifier,
// re-running the tools elsewhere, would report the difference as fabrication.

type Window = {
  from: string;
  to: string;
};

function iso(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * The most recent month the dataset covers *completely*.
 *
 * A half-finished month looks exactly like a collapse in revenue. A detector comparing a
 * fortnight of August against a full August would manufacture the loudest finding in the
 * feed out of nothing but the calendar, and it would do it every single month.
 */
function lastCompleteMonth(anchorIso: string): { year: number; month0: number } {
  const d = new Date(`${anchorIso.slice(0, 10)}T00:00:00.000Z`);
  const year = d.getUTCFullYear();
  const month0 = d.getUTCMonth();
  if (d.getUTCDate() === lastDayOfMonth(year, month0)) return { year, month0 };
  return month0 === 0 ? { year: year - 1, month0: 11 } : { year, month0: month0 - 1 };
}

/** The `months` complete calendar months ending at, and including, the anchor's month. */
function trailingMonths(anchorIso: string, months: number): Window {
  const end = lastCompleteMonth(anchorIso);
  const startIndex = end.year * 12 + end.month0 - (months - 1);
  const startYear = Math.floor(startIndex / 12);
  const startMonth0 = startIndex - startYear * 12;
  return {
    from: iso(startYear, startMonth0, 1),
    to: iso(end.year, end.month0, lastDayOfMonth(end.year, end.month0)),
  };
}

/** The same calendar months shifted whole years — the seasonally matched comparison. */
function shiftYear(window: Window, years: number): Window {
  const from = new Date(`${window.from}T00:00:00.000Z`);
  const to = new Date(`${window.to}T00:00:00.000Z`);
  const toYear = to.getUTCFullYear() + years;
  const toMonth0 = to.getUTCMonth();
  return {
    from: iso(from.getUTCFullYear() + years, from.getUTCMonth(), from.getUTCDate()),
    // The end day is re-derived rather than copied: 29 February shifted back a year is not a
    // date, and the tools reject an unparseable bound rather than guessing what was meant.
    to: iso(toYear, toMonth0, Math.min(to.getUTCDate(), lastDayOfMonth(toYear, toMonth0))),
  };
}

/**
 * The equal-length window immediately before this one, as ISO dates.
 *
 * Delegates to the tools' own `precedingPeriod` rather than reimplementing the arithmetic,
 * so a detector's "previous window" is byte-identical to the one `revenue_trend` computes
 * internally. Two definitions of "the period before" that differ by a day is how a dashboard
 * ends up with two irreconcilable numbers for the same question.
 */
function precedingWindow(window: Window): Window {
  const previous = precedingPeriod(periodOf(window.from, window.to));
  return {
    from: new Date(previous.fromMs).toISOString().slice(0, 10),
    to: new Date(previous.toMs).toISOString().slice(0, 10),
  };
}

type Quarter = Window & {
  label: string;
};

/** Calendar quarters lying wholly inside the data window. Partial quarters are excluded. */
function quartersWithin(from: string, to: string): Quarter[] {
  const out: Quarter[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    for (let q = 1; q <= 4; q++) {
      const startMonth0 = (q - 1) * 3;
      const endMonth0 = startMonth0 + 2;
      const quarter: Quarter = {
        label: `Q${q} ${year}`,
        from: iso(year, startMonth0, 1),
        to: iso(year, endMonth0, lastDayOfMonth(year, endMonth0)),
      };
      // A cohort measured over one month of a quarter is not comparable with one measured
      // over three, and comparing them anyway is how a "weak cohort" finding gets invented.
      if (quarter.from >= from && quarter.to <= to) out.push(quarter);
    }
  }
  return out;
}

// ─── Evidence gathering ─────────────────────────────────────────────────────────────

/**
 * A detector's tool session.
 *
 * Every figure a detector touches passes through here, which buys three properties at once:
 * the evidence attached to an insight is exactly the set of computations that produced it,
 * repeated calls collapse to a single receipt, and there is no code path by which a detector
 * could reach the raw rows without leaving a trace behind.
 */
class Probe {
  private readonly collected = new Map<string, Evidence>();

  constructor(private readonly ds: ClubDataset) {}

  /** Runs a tool. Throws on an unknown name or a refused call — both are bugs at this layer. */
  call(tool: string, params: Record<string, unknown>): Evidence {
    const impl = TOOL_REGISTRY.get(tool);
    if (!impl) throw new Error(`detector referenced unregistered tool "${tool}"`);
    const evidence = impl.run(params, this.ds);
    this.collected.set(evidence.id, evidence);
    return evidence;
  }

  /**
   * Runs a tool that is *allowed* to refuse.
   *
   * The tools throw rather than return a number when a question has no honest answer: a
   * percent change from a zero baseline, a retention rate for a quarter nobody joined in.
   * That refusal is a result, not a failure — the detector reads it as "no signal here" and
   * moves on. Coercing it into a zero would be exactly the fabrication the system forbids.
   *
   * An unregistered tool name still throws, because that is a typo, not a refusal.
   */
  attempt(tool: string, params: Record<string, unknown>): Evidence | null {
    if (!TOOL_REGISTRY.has(tool)) throw new Error(`detector referenced unregistered tool "${tool}"`);
    try {
      return this.call(tool, params);
    } catch {
      return null;
    }
  }

  /** Insertion-ordered, so the receipt drawer lists figures in the order they were derived. */
  evidence(): Evidence[] {
    return [...this.collected.values()];
  }
}

/** Reads the scalar out of an evidence record. Series and tables are never headline figures. */
const n = scalarOf;

// ─── Insight assembly ───────────────────────────────────────────────────────────────

/**
 * An insight id is a hash of the detector and the exact computations behind it.
 *
 * Two consequences worth the handful of lines. The same finding keeps the same id across
 * runs, so a dismissal could persist in a real build. And a finding whose underlying figures
 * have moved gets a *new* id, so yesterday's dismissal can never silently suppress today's
 * worse version of the same problem.
 */
function insightId(detectorId: string, evidence: Evidence[]): string {
  const fingerprint = evidence
    .map((e) => e.id)
    .sort()
    .join('|');
  return `${detectorId}-${createHash('sha256').update(fingerprint).digest('hex').slice(0, 10)}`;
}

function build(args: {
  detector: Detector;
  severity: InsightSeverity;
  probe: Probe;
  cited: EvidenceByKey;
  facts: NarrationFacts;
  actions: SuggestedAction[];
  detectedAt: string;
}): DetectedInsight {
  const { headline, narrative, recommendation } = narrate(args.detector.id, args.cited, args.facts);
  const evidence = args.probe.evidence();
  return {
    id: insightId(args.detector.id, evidence),
    kind: args.detector.kind,
    severity: args.severity,
    headline,
    narrative,
    recommendation,
    evidence,
    detector: args.detector.id,
    detectedAt: args.detectedAt,
    suggestedActions: args.actions,
  };
}

/**
 * The date every window is measured back from.
 *
 * Clamped to the last day the dataset covers. A caller passing today's date against a
 * dataset that ends last December would otherwise get an empty feed and no explanation;
 * clamping answers the question the data can actually support, and the receipts say which
 * dates were used, so nothing is hidden by the clamp.
 */
function anchorOf(ds: ClubDataset, ctx: DetectorContext): string {
  const now = ctx.now.slice(0, 10);
  return now > ds.club.dataTo ? ds.club.dataTo : now;
}

/** Sentence-cases a hyphenated domain value: `pro-shop` → `Pro shop`. */
function label(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Reads as prose in a task note, unlike the wire value. */
function plain(value: string): string {
  return value.replace(/-/g, ' ');
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Revenue category decline
// ════════════════════════════════════════════════════════════════════════════════════

/** The comparison window shared by every trend detector in this file. */
const TREND_WINDOW_MONTHS = 6;

/**
 * How far a revenue line must fall against the preceding equal window before it is news.
 *
 * Club revenue lines move a few percent between comparable half-years on membership mix and
 * price-list changes alone. Twelve percent is roughly double that band; past it the
 * category's contribution to the operating budget has genuinely changed, and the finance
 * committee will be asking about it whether or not this feed raises it first.
 */
const MATERIAL_DECLINE_PCT = -12;

/**
 * Below this, a decline is a fall in progress rather than a soft half-year.
 *
 * A fifth of a category's revenue is not absorbed by trimming a roster: it is the point at
 * which either the department's cost base is re-cut or the line itself has to be fixed.
 */
const SEVERE_DECLINE_PCT = -20;

/**
 * The seasonal corroboration bar.
 *
 * A preceding-window comparison cannot tell a decline from a season — March-to-August against
 * September-to-February is two different halves of the club calendar. The same months a year
 * earlier must show the fall too, at least half as steeply, or this detector treats the move
 * as the calendar doing its job and stays quiet.
 */
const SEASONAL_CORROBORATION_PCT = MATERIAL_DECLINE_PCT / 2;

/**
 * Minimum size of a category before a percentage on it means anything.
 *
 * Against a club billing millions in dues, a line under twenty-five thousand dollars across
 * six months can halve on two cancelled functions. Percentages on small bases are the most
 * reliable way there is to fill a feed with noise.
 */
const MIN_CATEGORY_REVENUE_USD = 25_000;

const revenueCategoryDecline: Detector = {
  id: 'revenue-category-decline',
  kind: 'revenue',
  question:
    'Is a revenue category falling against the period before it, and is the fall real rather than seasonal?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    const current = trailingMonths(anchor, TREND_WINDOW_MONTHS);
    const previous = precedingWindow(current);
    const yearAgo = shiftYear(current, -1);

    interface Candidate {
      category: RevenueCategory;
      probe: Probe;
      cited: EvidenceByKey;
      trendPct: number;
      shortfallUsd: number;
    }

    const candidates: Candidate[] = [];

    for (const category of REVENUE_CATEGORIES) {
      const probe = new Probe(ds);

      const currentTotal = probe.call('revenue_total', { ...current, category });
      if (n(currentTotal) < MIN_CATEGORY_REVENUE_USD) continue;

      const trend = probe.attempt('revenue_trend', { ...current, category });
      if (trend === null || n(trend) > MATERIAL_DECLINE_PCT) continue;

      const previousTotal = probe.call('revenue_total', { ...previous, category });
      const yearAgoTotal = probe.call('revenue_total', { ...yearAgo, category });

      // Corroboration, not decoration. Without it a winter-versus-summer comparison would
      // fire on dining every single year, and a feed that cries wolf annually has taught its
      // reader to skip it by the second year.
      if (n(yearAgoTotal) <= 0) continue;
      const yearOnYearPct = ((n(currentTotal) - n(yearAgoTotal)) / n(yearAgoTotal)) * 100;
      if (yearOnYearPct > SEASONAL_CORROBORATION_PCT) continue;

      candidates.push({
        category,
        probe,
        cited: { current: currentTotal, previous: previousTotal, yearAgo: yearAgoTotal, trend },
        trendPct: n(trend),
        shortfallUsd: n(previousTotal) - n(currentTotal),
      });
    }

    if (candidates.length === 0) return null;

    // Ranked by dollars lost rather than by percentage. A general manager acts on the line
    // that took the most money off the table, and the steepest percentage is very often the
    // smallest line in the club.
    candidates.sort(
      (a, b) => b.shortfallUsd - a.shortfallUsd || a.category.localeCompare(b.category),
    );
    const worst = candidates[0];

    return build({
      detector: revenueCategoryDecline,
      severity: worst.trendPct <= SEVERE_DECLINE_PCT ? 'critical' : 'elevated',
      probe: worst.probe,
      cited: worst.cited,
      facts: { category: worst.category, categoryLabel: label(worst.category) },
      detectedAt: anchor,
      actions: [
        {
          kind: 'create_task',
          label: `Review the ${plain(worst.category)} line with the finance committee`,
          args: {
            title: `Investigate the sustained ${plain(worst.category)} revenue decline`,
            assignee: 'General Manager',
            dueDate: current.to,
            notes:
              `${label(worst.category)} revenue for ${current.from} to ${current.to} is down ` +
              `against both the preceding equal window and the same months a year earlier. ` +
              `Bring volume and average spend by month since the decline began.`,
          },
        },
      ],
    });
  },
};

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Facility under-utilisation
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * The recurring window under examination: weekday mornings.
 *
 * Chosen because it is the block clubs most reliably staff and least reliably programme.
 * `hourTo` is exclusive, matching `facility_utilisation`, so this reads as "05:00 up to
 * 11:00" — first light through late morning, before the lunch trade begins.
 */
const IDLE_WINDOW = { dayOfWeek: 'weekday' as const, hourFrom: 5, hourTo: 11 };

/**
 * The share of a facility's traffic below which its weekday mornings are standing empty.
 *
 * Weekday mornings are roughly a quarter of staffed hours. A facility drawing under a
 * twentieth of its visits there is not merely quieter in the morning — it is running that
 * block near-empty while paying for it, which is a different and far more actionable fact.
 */
const IDLE_WINDOW_SHARE_PCT = 5;

/** Under this share the block is not underused, it is unattended. */
const SEVERELY_IDLE_SHARE_PCT = 3;

/**
 * Minimum traffic before a share is meaningful.
 *
 * A facility with a handful of visits across two years produces shares that swing on single
 * rows. This also excludes facilities the club does not operate — this dataset's club is
 * landlocked and has no marina — where a zero would otherwise read as a finding.
 */
const MIN_FACILITY_VISITS = 500;

const facilityUnderutilisation: Detector = {
  id: 'facility-underutilisation',
  kind: 'utilisation',
  question:
    'Is a facility the club staffs on weekday mornings going essentially unused in that block?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    // The whole covered history. An idle block is a standing condition, and measuring it over
    // a single quarter would let one wet month decide whether the club has a problem.
    const window = { from: ds.club.dataFrom, to: anchor };

    interface Candidate {
      facility: FacilityKind;
      probe: Probe;
      cited: EvidenceByKey;
      sharePct: number;
      totalVisits: number;
    }

    const candidates: Candidate[] = [];

    for (const facility of FACILITIES) {
      const probe = new Probe(ds);

      const total = probe.call('facility_utilisation', { facility, ...window, dayOfWeek: 'all' });
      if (n(total) < MIN_FACILITY_VISITS) continue;

      const idle = probe.call('facility_utilisation', { facility, ...window, ...IDLE_WINDOW });
      // A block with literally no recorded use is not being run at all — the dining room at
      // eight in the morning is a closed kitchen, not a wasted asset. Reporting it as idle
      // capacity would be recommending that the club staff a service it chose not to offer.
      if (n(idle) === 0) continue;

      const sharePct = (n(idle) / n(total)) * 100;
      if (sharePct >= IDLE_WINDOW_SHARE_PCT) continue;

      candidates.push({ facility, probe, cited: { window: idle, total }, sharePct, totalVisits: n(total) });
    }

    if (candidates.length === 0) return null;

    // The emptiest block leads; where two are equally starved the busier facility wins,
    // because the same hour of a professional's time converts more members there.
    candidates.sort((a, b) => a.sharePct - b.sharePct || b.totalVisits - a.totalVisits);
    const worst = candidates[0];

    return build({
      detector: facilityUnderutilisation,
      // Deliberately never critical. Idle capacity is revenue the club is not yet earning,
      // not revenue it is losing, and ranking it above a live decline would misorder the
      // general manager's morning.
      severity: worst.sharePct < SEVERELY_IDLE_SHARE_PCT ? 'elevated' : 'informational',
      probe: worst.probe,
      cited: worst.cited,
      facts: { facility: worst.facility, facilityPlural: `${plain(worst.facility)}s` },
      detectedAt: anchor,
      actions: [
        {
          kind: 'create_task',
          label: `Programme the weekday-morning block at the ${plain(worst.facility)}`,
          args: {
            title: `Design weekday-morning programming for the ${plain(worst.facility)}`,
            assignee: 'Director of Recreation',
            dueDate: anchor,
            notes:
              `Weekday mornings up to eleven o'clock carry a negligible share of this ` +
              `facility's traffic across the whole data window. Propose a clinic, ladder or ` +
              `social format and the staffing it would need.`,
          },
        },
      ],
    });
  },
};

// ════════════════════════════════════════════════════════════════════════════════════
// 3. Churn cohort exposure
// ════════════════════════════════════════════════════════════════════════════════════

/** The band a retention programme actually works: elevated and worse. */
const EXPOSURE_BAND = 'elevated';

/**
 * At-risk dues as a share of the club's trailing-twelve-month dues income.
 *
 * Expressed as a share rather than as a dollar figure on purpose: a threshold of "half a
 * million dollars" is a crisis at one club and a rounding error at another, and this detector
 * has to behave the same at both. Private clubs budget for roughly five to eight percent
 * annual attrition. Once three percent of dues income sits with members the model can name
 * one by one, half the year's expected loss is already on a list somebody can work — and not
 * working it becomes a decision rather than an accident.
 */
const CHURN_EXPOSURE_SHARE_PCT = 3;

/** Past this, the exposure exceeds the attrition a club's budget normally absorbs. */
const SEVERE_CHURN_EXPOSURE_SHARE_PCT = 8;

/** Twelve complete months, so the denominator covers one full dues cycle and every season. */
const DUES_BASE_MONTHS = 12;

const churnCohortExposure: Detector = {
  id: 'churn-cohort-exposure',
  kind: 'churn',
  question: 'How much contracted dues income sits with members the churn model has flagged?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    const probe = new Probe(ds);

    const size = probe.call('churn_cohort_size', { band: EXPOSURE_BAND });
    const exposure = probe.call('dues_at_risk', { band: EXPOSURE_BAND });
    if (n(size) === 0) return null;

    // The denominator is dues actually *billed*, not dues listed on the roll, so exposure is
    // measured against money the club collected rather than against a price list.
    const duesBase = probe.call('revenue_total', {
      ...trailingMonths(anchor, DUES_BASE_MONTHS),
      category: 'dues',
    });
    if (n(duesBase) <= 0) return null;

    const sharePct = (n(exposure) / n(duesBase)) * 100;
    if (sharePct < CHURN_EXPOSURE_SHARE_PCT) return null;

    return build({
      detector: churnCohortExposure,
      // Severity is keyed to money, not headcount: fifty social members at risk and fifty
      // full-golf members at risk are the same number and two completely different problems.
      severity: sharePct >= SEVERE_CHURN_EXPOSURE_SHARE_PCT ? 'critical' : 'elevated',
      probe,
      cited: { size, exposure, duesBase },
      facts: { band: EXPOSURE_BAND },
      detectedAt: anchor,
      actions: [
        {
          kind: 'schedule_report',
          label: 'Send the elevated-risk cohort to the membership director weekly',
          args: {
            name: 'Elevated churn-risk cohort, ranked by annual dues',
            cadence: 'weekly on Monday',
            recipients: 'Membership Director, General Manager',
          },
        },
      ],
    });
  },
};

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Weak joiner cohort
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * How far below the club's own retention a joining quarter has to sit.
 *
 * At the cohort sizes a club recruits in — a few dozen a quarter — one or two extra
 * resignations move retention three or four points, so ordinary sampling noise lives below
 * five. Seven points is roughly double that noise floor: past it, something about that
 * quarter's intake or its onboarding is the explanation, not chance.
 */
const COHORT_RETENTION_GAP_POINTS = 7;

/** A gap this wide compounds: the cohort sheds members faster than the club replaces them. */
const SEVERE_COHORT_RETENTION_GAP_POINTS = 15;

/**
 * Minimum cohort size.
 *
 * A quarter in which five people joined produces retention rates of 60% or 80% and nothing
 * in between. Reporting that as a cohort problem would be reporting the arithmetic of small
 * numbers as a finding about member services.
 */
const MIN_COHORT_SIZE = 20;

const weakJoinerCohort: Detector = {
  id: 'weak-joiner-cohort',
  kind: 'membership',
  question: 'Did one joining cohort retain materially worse than the club as a whole?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    const clubWide = { from: ds.club.dataFrom, to: anchor };

    const baselineProbe = new Probe(ds);
    const baseline = baselineProbe.attempt('cohort_retention', clubWide);
    if (baseline === null) return null;

    interface Candidate {
      quarter: Quarter;
      probe: Probe;
      cited: EvidenceByKey;
      gapPoints: number;
    }

    const candidates: Candidate[] = [];

    for (const quarter of quartersWithin(ds.club.dataFrom, anchor)) {
      const probe = new Probe(ds);
      const cohort = probe.attempt('cohort_retention', { from: quarter.from, to: quarter.to });
      if (cohort === null) continue;

      // `rowCount` is the cohort itself — the tool cites one row per member who joined inside
      // the window. It gates the detector but is never narrated: no tool returns it as a
      // scalar, so there is no receipt to hang a citation on, and a figure without a receipt
      // does not go on the page. Declining to state it is the contract working, not a gap.
      if (cohort.rowCount < MIN_COHORT_SIZE) continue;

      // The baseline deliberately includes this cohort, which drags it toward the cohort's
      // own rate and *understates* the gap. A comparison that flatters the finding is not
      // worth making; one that survives being made conservatively is.
      const gapPoints = n(baseline) - n(cohort);
      if (gapPoints < COHORT_RETENTION_GAP_POINTS) continue;

      // Re-run through this candidate's own probe so the insight's receipts carry both
      // figures. Evidence ids are a hash of tool, version and params, so this is the same
      // record, not a second one.
      probe.call('cohort_retention', clubWide);

      candidates.push({ quarter, probe, cited: { cohort, baseline }, gapPoints });
    }

    if (candidates.length === 0) return null;

    candidates.sort(
      (a, b) => b.gapPoints - a.gapPoints || a.quarter.from.localeCompare(b.quarter.from),
    );
    const worst = candidates[0];

    return build({
      detector: weakJoinerCohort,
      severity:
        worst.gapPoints >= SEVERE_COHORT_RETENTION_GAP_POINTS ? 'critical' : 'elevated',
      probe: worst.probe,
      cited: worst.cited,
      facts: { quarterLabel: worst.quarter.label },
      detectedAt: anchor,
      actions: [
        {
          kind: 'create_task',
          label: 'Rebuild onboarding before the next intake',
          args: {
            title: `Redesign new-member onboarding after the ${worst.quarter.label} cohort`,
            assignee: 'Membership Director',
            dueDate: anchor,
            notes:
              `Members who joined in ${worst.quarter.label} are retaining below the club's own ` +
              `rate for the data window. Compare their first-quarter visit counts and sponsor ` +
              `assignments against later intakes before running another recruitment drive.`,
          },
        },
      ],
    });
  },
};

// ════════════════════════════════════════════════════════════════════════════════════
// 5. Guest fee surge
// ════════════════════════════════════════════════════════════════════════════════════

/** A season, in complete calendar months. */
const SEASON_MONTHS = 3;

/**
 * How far guest-fee revenue must exceed the same season last year to be a change rather than
 * a good summer.
 *
 * Guest play swings with weather and with a single well-attended member-guest weekend, and a
 * fifth either way is ordinary. A quarter above last year is beyond what weather produces and
 * points at something the club *did* — a reciprocal arrangement, a promotion, a rate change —
 * which is a decision worth revisiting deliberately rather than discovering at budget time.
 */
const SEASONAL_SURGE_PCT = 25;

/** Below this, the prior-year base is too small for a percentage to carry any meaning. */
const MIN_SEASON_BASE_USD = 20_000;

const guestFeeSurge: Detector = {
  id: 'guest-fee-surge',
  kind: 'revenue',
  question: 'Is guest-fee revenue running materially above the same season last year?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    const season = trailingMonths(anchor, SEASON_MONTHS);
    const lastYear = shiftYear(season, -1);
    const probe = new Probe(ds);

    const current = probe.call('revenue_total', { ...season, category: 'guest-fees' });
    const yearAgo = probe.call('revenue_total', { ...lastYear, category: 'guest-fees' });

    if (n(yearAgo) < MIN_SEASON_BASE_USD) return null;
    const surgePct = ((n(current) - n(yearAgo)) / n(yearAgo)) * 100;
    if (surgePct < SEASONAL_SURGE_PCT) return null;

    return build({
      detector: guestFeeSurge,
      // Informational by design. Revenue arriving is not an incident, and a feed that shouts
      // at good news teaches its reader that severity means nothing. The finding still
      // matters, because guest access at peak hours is sold out of member capacity.
      severity: 'informational',
      probe,
      cited: { current, yearAgo },
      facts: { seasonFrom: season.from, seasonTo: season.to },
      detectedAt: anchor,
      actions: [
        {
          kind: 'create_task',
          label: 'Price guest access against peak member demand',
          args: {
            title: 'Review guest access policy against peak-hour member demand',
            assignee: 'General Manager',
            dueDate: season.to,
            notes:
              `Guest-fee revenue this season is materially above the same months last year. ` +
              `Establish whether guest play is displacing member tee times at peak hours, and ` +
              `whether the guest rate reflects what those hours are worth to a member.`,
          },
        },
      ],
    });
  },
};

// ════════════════════════════════════════════════════════════════════════════════════
// 6. Event attendance drop
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Percentage points of attendance rate lost against the preceding equal window.
 *
 * The preceding window is the right comparator here, unlike for the dollar detectors: a
 * registration-to-attendance *ratio* barely moves with the season, because the members who
 * register in December are the ones who register in June. Six points is roughly three extra
 * no-shows in every fifty registrations — enough to show up in catering waste and in what the
 * events committee is already hearing, which means the feed is late if it waits for more.
 */
const ATTENDANCE_DROP_POINTS = 6;

/** A drop this size is a programming failure, not a run of bad weather. */
const SEVERE_ATTENDANCE_DROP_POINTS = 15;

const eventAttendanceDrop: Detector = {
  id: 'event-attendance-drop',
  kind: 'engagement',
  question: 'Are the members who register for events still turning up?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    const current = trailingMonths(anchor, TREND_WINDOW_MONTHS);
    const previous = precedingWindow(current);
    const probe = new Probe(ds);

    const currentRate = probe.attempt('event_attendance_rate', current);
    const previousRate = probe.attempt('event_attendance_rate', previous);
    if (currentRate === null || previousRate === null) return null;

    const dropPoints = n(previousRate) - n(currentRate);
    if (dropPoints < ATTENDANCE_DROP_POINTS) return null;

    return build({
      detector: eventAttendanceDrop,
      severity: dropPoints >= SEVERE_ATTENDANCE_DROP_POINTS ? 'critical' : 'elevated',
      probe,
      cited: { current: currentRate, previous: previousRate },
      facts: {},
      detectedAt: anchor,
      actions: [
        {
          kind: 'create_task',
          label: 'Take the no-show rate to the events committee',
          args: {
            title: 'Investigate rising event no-shows',
            assignee: 'Events Manager',
            dueDate: current.to,
            notes:
              `Attendance against registrations has fallen against the preceding equal window. ` +
              `Break the rate down by event kind and by whether a deposit was taken before ` +
              `changing the programme.`,
          },
        },
      ],
    });
  },
};

// ════════════════════════════════════════════════════════════════════════════════════
// 7. Spend per member drift
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * How far average discretionary spend per active member must move to count as behaviour.
 *
 * Measured against the same six months a year earlier rather than the preceding window,
 * because dining, golf and pool spend are all seasonal and a preceding-window comparison
 * would report the calendar as a behaviour change. Eight percent is roughly double the uplift
 * a club's own menu and green-fee pricing contributes across a year: below it the number is
 * mostly the price list, above it members are choosing differently.
 *
 * The divisor — active members on the roll — is identical in both windows, because
 * `avg_discretionary_spend` scores the roll as at the dataset's end date. So a movement here
 * is a movement in spending, never an artefact of the roll shrinking underneath it.
 */
const SPEND_DRIFT_PCT = 8;

/**
 * Minimum prior-year spend per head before a ratio is worth reading.
 *
 * Under a couple of hundred dollars a member across six months there is barely any
 * discretionary behaviour in the data, and the percentage is decided by a handful of rows.
 */
const MIN_SPEND_BASELINE_USD = 250;

const spendPerMemberDrift: Detector = {
  id: 'spend-per-member-drift',
  kind: 'engagement',
  question: 'Is what an average active member spends beyond their dues moving materially?',

  run(ds, ctx) {
    const anchor = anchorOf(ds, ctx);
    const current = trailingMonths(anchor, TREND_WINDOW_MONTHS);
    const lastYear = shiftYear(current, -1);
    const probe = new Probe(ds);

    const currentSpend = probe.attempt('avg_discretionary_spend', current);
    const yearAgoSpend = probe.attempt('avg_discretionary_spend', lastYear);
    if (currentSpend === null || yearAgoSpend === null) return null;
    if (n(yearAgoSpend) < MIN_SPEND_BASELINE_USD) return null;

    const driftPct = ((n(currentSpend) - n(yearAgoSpend)) / n(yearAgoSpend)) * 100;
    if (Math.abs(driftPct) < SPEND_DRIFT_PCT) return null;

    // Both directions are worth surfacing and they are not the same finding. A fall is the
    // churn model's leading indicator arriving at club scale, and earns elevated. A rise is a
    // fact about mix the club should understand before it budgets as though it will persist.
    const falling = driftPct < 0;

    return build({
      detector: spendPerMemberDrift,
      severity: falling ? 'elevated' : 'informational',
      probe,
      cited: { current: currentSpend, yearAgo: yearAgoSpend },
      facts: { direction: falling ? 'fall' : 'rise' },
      detectedAt: anchor,
      actions: [
        {
          kind: 'create_task',
          label: falling
            ? 'Break the spend decline down by category and cohort'
            : 'Confirm what is carrying the increase before budgeting on it',
          args: {
            title: falling
              ? 'Investigate falling discretionary spend per member'
              : 'Attribute the rise in discretionary spend per member',
            assignee: 'General Manager',
            dueDate: current.to,
            notes:
              `Average non-dues spend per active member has moved against the same six months ` +
              `a year earlier. Split the movement by revenue category and by membership ` +
              `category before drawing any conclusion about engagement.`,
          },
        },
      ],
    });
  },
};

// ─── The register ───────────────────────────────────────────────────────────────────

/**
 * Every detector, in editorial order.
 *
 * The feed is sorted by severity and then by dollars, so this order is only the final
 * tie-break — but it is the order a reader should see when nothing else separates two
 * findings, which is why money in motion leads and slow drifts trail.
 */
export const DETECTORS: readonly Detector[] = [
  revenueCategoryDecline,
  facilityUnderutilisation,
  churnCohortExposure,
  weakJoinerCohort,
  guestFeeSurge,
  eventAttendanceDrop,
  spendPerMemberDrift,
];
