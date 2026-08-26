import { scalarOf, type Evidence, type Unit } from '../tools/evidence.js';

/**
 * Narration — turning a fired detector into two or three sentences a general manager reads.
 *
 * ## Why there is no model call in this file
 *
 * There is no API key in this environment, and the honest version of that constraint is
 * worth more than a fake one: the shape below is exactly the shape the model call would
 * take. The detector decides *what is true* and hands over the evidence; narration decides
 * only *how to say it*, and can reach for no number that did not arrive in `evidenceByKey`.
 * Swapping this function for a model call changes which component writes the sentence and
 * nothing at all about what may appear inside it — the citation contract, the verifier and
 * every test around them stay exactly as they are.
 *
 * That is the whole argument for the architecture in one file. If prose generation can be
 * swapped between a template and a language model without touching the grounding guarantee,
 * then the guarantee never depended on the model behaving.
 *
 * ## The two rules every template obeys
 *
 * 1. **Every figure is cited.** `[[e:<id>|<figure>]]`, where the id is a real evidence
 *    record and the figure is derived from that record's value by the formatters below.
 *    Nothing else in this file is permitted to produce a digit.
 * 2. **No bare numbers in the prose around them.** `verify/numbers.ts` exempts years and
 *    small ordinals only, so "in the last 90 days" is an uncited claim and fails the gate,
 *    while "in the last ninety days" is prose. The templates spell quantities out in words
 *    for exactly that reason — it is a constraint, and it also happens to read better.
 *
 *    One sharp edge, found by the gate rather than by inspection, and left documented here
 *    instead of papered over: the year exemption requires the token to carry no comma, since
 *    a comma is how a thousands separator is spelled. So "joined in Q1 2025, only 71%…" fails
 *    on the year while "joined in Q1 2025 only 71%…" passes. The rule is stricter than it
 *    needs to be, and that is the correct direction for a rule whose job is to catch invented
 *    numbers — the fix belongs in the sentence, never in the verifier.
 *
 * ## On voice
 *
 * Written the way a good analyst briefs a GM at eight in the morning: the finding first, the
 * money second, the caveat only where it changes the decision. No hedging, no "it appears
 * that", no exclamation marks, and a different sentence shape per detector so that a feed of
 * seven findings does not read as one template with the nouns swapped.
 */

export type EvidenceByKey = Readonly<Record<string, Evidence>>;

/** Non-numeric context: category names, quarter labels, direction. Never a figure. */
export type NarrationFacts = Readonly<Record<string, string>>;

export interface Narration {
  /** Scannable and figure-free — a headline cannot carry a citation, so it carries no number. */
  headline: string;
  /** Prose. Every figure inside is a `[[e:id|figure]]` citation. */
  narrative: string;
  /** The single most useful next step. Also figure-free, for the same reason as the headline. */
  recommendation: string;
}

// ─── Figure formatting ──────────────────────────────────────────────────────────────

/**
 * Round to a step, and build the written figure from the rounded value.
 *
 * This is the load-bearing half of the whole file. `verify/numbers.ts` accepts a figure when
 * the true value lies inside the interval that rounds to it — half a step either side. By
 * formatting only ever as `round(value / step) * step`, the written figure is by construction
 * at most half a step from the truth, so a correctly-formatted figure cannot fail the gate.
 *
 * The corollary matters more: if a figure ever *does* fail, the bug is here, in the writing,
 * and never in the checking. Widening the verifier to accept a bad format would be deleting
 * the only mechanism that catches a real fabrication.
 */
function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** `-83000` → `-$83k`. The sign leads the currency symbol, which is what `parseFigure` reads. */
function withSign(value: number, body: string): string {
  return `${value < 0 ? '-' : ''}$${body}`;
}

/**
 * Money at the precision a person would actually say out loud.
 *
 * Millions to one decimal, thousands whole, and anything smaller to the dollar. A club GM
 * says "dining is down eighty grand", not "down $83,028.41", and a narrative that reads like
 * a ledger export gets skimmed. The rounding-aware verifier is what makes writing this way
 * safe rather than sloppy — `$381k` is a checkable claim about a value in a stated interval.
 */
export function formatUsd(value: number): string {
  const magnitude = Math.abs(value);

  if (magnitude >= 1_000_000) {
    const rounded = roundToStep(value, 100_000);
    return withSign(rounded, `${(Math.abs(rounded) / 1_000_000).toFixed(1)}M`);
  }
  if (magnitude >= 10_000) {
    const rounded = roundToStep(value, 1_000);
    return withSign(rounded, `${Math.abs(rounded) / 1_000}k`);
  }
  const rounded = roundToStep(value, 1);
  return withSign(rounded, Math.abs(rounded).toLocaleString('en-US'));
}

/**
 * Percentage points. One decimal below ten, whole numbers above.
 *
 * Writing "2%" for a share of 1.94 is technically defensible under the rounding rule and
 * useless to a reader deciding whether a court block is empty: at small magnitudes the
 * decimal is the information.
 */
export function formatPercent(value: number): string {
  if (Math.abs(value) < 10) return `${roundToStep(value, 0.1).toFixed(1)}%`;
  return `${roundToStep(value, 1)}%`;
}

/** Counts are exact — "47 members" has to mean forty-seven, and the verifier enforces it. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatByUnit(value: number, unit: Unit): string {
  switch (unit) {
    case 'usd':
      return formatUsd(value);
    case 'percent':
      return formatPercent(value);
    case 'count':
      return formatCount(value);
    default:
      // Scores, ratios, days and minutes all read as plain numbers. Keeping one fallback
      // rather than a case per unit means a new unit degrades to something checkable
      // instead of to something unformatted.
      return String(roundToStep(value, 0.01));
  }
}

// ─── Template plumbing ──────────────────────────────────────────────────────────────

/** Produces `[[e:<id>|<figure>]]` for one gathered evidence record. */
type Cite = (key: string) => string;

/** Reads a piece of non-numeric context. */
type Fact = (key: string) => string;

type Template = (cite: Cite, fact: Fact) => Narration;

function makeCite(detectorId: string, evidenceByKey: EvidenceByKey): Cite {
  return (key) => {
    const evidence = evidenceByKey[key];
    // Loud, immediately. A missing key would otherwise become a dangling citation that the
    // verifier blocks with a message about evidence that was never produced — true, but it
    // would send the next reader looking for a data bug instead of a typo in a template.
    if (!evidence) {
      throw new Error(`narration for "${detectorId}" cited unknown evidence key "${key}"`);
    }
    // Only scalars are citable, because only scalars are what the verifier recomputes and
    // compares. A series or a table belongs in a chart, with its own receipt.
    return `[[e:${evidence.id}|${formatByUnit(scalarOf(evidence), evidence.unit)}]]`;
  };
}

function makeFact(detectorId: string, facts: NarrationFacts): Fact {
  return (key) => {
    const value = facts[key];
    if (value === undefined) {
      throw new Error(`narration for "${detectorId}" needs fact "${key}", which was not supplied`);
    }
    return value;
  };
}

// ─── The templates ──────────────────────────────────────────────────────────────────
//
// One per detector, keyed by detector id. Deliberately written as prose rather than
// assembled from clauses: a sentence builder produces grammatically valid text that nobody
// wants to read, and the variety between these seven is the point.

const TEMPLATES: Record<string, Template> = {
  'revenue-category-decline': (cite, fact) => ({
    headline: `${fact('categoryLabel')} revenue is in sustained decline`,
    narrative:
      `${fact('categoryLabel')} took ${cite('current')} over the last six months against ` +
      `${cite('previous')} in the equal window before it, a move of ${cite('trend')}. The same ` +
      `six months a year earlier brought ${cite('yearAgo')}, which rules out the season: this ` +
      `line has lost real volume and has stayed down rather than dipping once.`,
    recommendation:
      `Put the ${fact('category').replace(/-/g, ' ')} operation on the next committee agenda ` +
      `with volume and average spend broken out by month since the fall began, and read the ` +
      `negative member notes from the same window before deciding whether this is menu, ` +
      `service or staffing.`,
  }),

  'facility-underutilisation': (cite, fact) => ({
    headline: `Weekday mornings at the ${fact('facilityPlural')} are running empty`,
    narrative:
      `Weekday mornings before 11am drew ${cite('window')} check-ins at the ` +
      `${fact('facilityPlural')} across the whole data window, out of ${cite('total')} in total. ` +
      `That block is already staffed and already paid for, and it is carrying almost none of ` +
      `the traffic.`,
    recommendation:
      `Programme the morning block before spending anything on new capacity: a coached clinic, ` +
      `a ladder or a standing social hour costs one professional's time and converts hours the ` +
      `club is paying for either way.`,
  }),

  'churn-cohort-exposure': (cite) => ({
    headline: 'Elevated churn risk is concentrated in a cohort the club can name',
    narrative:
      `${cite('size')} active members now score elevated or worse on the churn model, and ` +
      `between them they hold ${cite('exposure')} of contracted annual dues — against the ` +
      `${cite('duesBase')} the club billed in dues over the last twelve months. Every one of ` +
      `them arrives with a score, a band and the signals that produced it, so this is exposure ` +
      `the club can work rather than absorb.`,
    recommendation:
      `Work the cohort in dues order rather than alphabetically: the membership director takes ` +
      `the highest-dues names this month, and each call opens with the specific signal the ` +
      `model flagged rather than a general enquiry about how they are finding the club.`,
  }),

  'weak-joiner-cohort': (cite, fact) => ({
    headline: `The ${fact('quarterLabel')} joiners are retaining worse than the rest of the club`,
    narrative:
      // The year carries no comma after it on purpose — see the note on exempt figures above.
      `Of the members who joined in ${fact('quarterLabel')} only ${cite('cohort')} are still ` +
      `active, against ${cite('baseline')} across everyone who joined inside the data window. ` +
      `That baseline includes this cohort itself, so the real gap against other intakes is ` +
      `wider than the one shown here — and the failure sits after the signature, not before it.`,
    recommendation:
      `Fix onboarding before running another recruitment drive: a named sponsor, a group ` +
      `placement in the first month and a check-in at ninety days cost less than replacing the ` +
      `members this cohort is still losing.`,
  }),

  'guest-fee-surge': (cite) => ({
    headline: 'Guest fee revenue has jumped against last summer',
    narrative:
      `Guest fees came to ${cite('current')} this season against ${cite('yearAgo')} in the same ` +
      `three months last year. That is incremental revenue nobody budgeted for, and it is also ` +
      `peak-season capacity being sold at guest rates instead of held for the members who pay ` +
      `dues for it.`,
    recommendation:
      `Read this in both directions before anything is renewed: measure whether guest play is ` +
      `displacing member tee times at peak hours, then price guest access against what those ` +
      `hours are worth to a member rather than against what the neighbouring club charges.`,
  }),

  'event-attendance-drop': (cite) => ({
    headline: 'Members who register for events have stopped turning up',
    narrative:
      `Events held in the last six months converted ${cite('current')} of their registrations ` +
      `into attendance, down from ${cite('previous')} across the six months before. A no-show ` +
      `costs the club the same as a guest in catering and staffing, so the gap is a straight ` +
      `loss against the events budget rather than a soft engagement signal.`,
    recommendation:
      `Split the rate by event kind and by whether a deposit was taken before touching the ` +
      `programme itself — no-shows usually concentrate in free events, and a deposit fixes that ` +
      `far more cheaply than a new calendar does.`,
  }),

  'spend-per-member-drift': (cite, fact) =>
    fact('direction') === 'fall'
      ? {
          headline: 'Discretionary spend per member is falling',
          narrative:
            `Active members spent an average of ${cite('current')} outside their dues over the ` +
            `last six months, against ${cite('yearAgo')} in the same six months a year earlier. ` +
            `Discretionary spend is the leading indicator in this club's churn model — it falls ` +
            `months before a resignation letter arrives — so a move of this size is a retention ` +
            `warning wearing a revenue costume.`,
          recommendation:
            `Split the fall by revenue category and by membership category before concluding ` +
            `anything: a drop concentrated in one category is an operational problem, and a drop ` +
            `spread evenly across all of them is a membership problem.`,
        }
      : {
          headline: 'Discretionary spend per member is climbing',
          narrative:
            `Active members spent an average of ${cite('current')} outside their dues over the ` +
            `last six months, against ${cite('yearAgo')} in the same six months a year earlier. ` +
            `The roll is scored the same way in both windows, so this is members behaving ` +
            `differently rather than a smaller denominator flattering the average.`,
          recommendation:
            `Attribute the increase by category before it is built into next year's budget: ` +
            `growth carried by one seasonal line is not the same asset as growth spread across ` +
            `everyday member spending, and only one of them can be relied on.`,
        },
};

/**
 * Narrates one fired detector.
 *
 * Throws on an unknown detector id rather than emitting a placeholder. A detector shipped
 * without a template should fail at the first test run, not appear in a live feed as an
 * insight with no words in it.
 */
export function narrate(
  detectorId: string,
  evidenceByKey: EvidenceByKey,
  facts: NarrationFacts,
): Narration {
  const template = TEMPLATES[detectorId];
  if (!template) throw new Error(`no narration template registered for detector "${detectorId}"`);
  return template(makeCite(detectorId, evidenceByKey), makeFact(detectorId, facts));
}

/** Detector ids that can be narrated. Used by the tests to prove the two lists agree. */
export function narratableDetectors(): string[] {
  return Object.keys(TEMPLATES).sort();
}
