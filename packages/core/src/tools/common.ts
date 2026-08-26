import type { ToolParamSpec } from './evidence.js';
import type {
  FacilityKind,
  MemberStatus,
  MembershipCategory,
  RevenueCategory,
} from '../domain/types.js';

/**
 * Shared primitives for the analysis tools.
 *
 * Everything here exists to protect one property: a tool must be a *pure function of its
 * stored params*. The verifier re-executes each tool from the params recorded on its
 * Evidence record and compares the result to what the model wrote. If any tool depended on
 * the wall clock, the machine's timezone, or object iteration order, that recomputation
 * would drift and the grounding guarantee would be theatre.
 */

// ─── Domain value lists ─────────────────────────────────────────────────────────────
// Enumerated once, here, so that a tool's param spec, its runtime guard, and the JSON
// Schema handed to the model can never disagree about what a valid value is.

export const REVENUE_CATEGORIES: readonly RevenueCategory[] = [
  'dues',
  'dining',
  'bar',
  'events',
  'pro-shop',
  'guest-fees',
  'lessons',
];

export const FACILITIES: readonly FacilityKind[] = [
  'golf-course',
  'tennis-court',
  'dining-room',
  'fitness-centre',
  'pool',
  'marina-berth',
];

export const MEMBERSHIP_CATEGORIES: readonly MembershipCategory[] = [
  'full-golf',
  'social',
  'junior-executive',
  'corporate',
  'non-resident',
];

export const MEMBER_STATUSES: readonly MemberStatus[] = ['active', 'resigned', 'suspended'];

/** Ordered weakest to strongest, so "at or above band X" is an index comparison. */
export const RISK_BANDS = ['low', 'watch', 'elevated', 'critical'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** Bands a caller may threshold on. 'low' is omitted: "at or above low" is every member. */
export const THRESHOLD_BANDS: readonly RiskBand[] = ['watch', 'elevated', 'critical'];

export function bandAtOrAbove(band: RiskBand, threshold: RiskBand): boolean {
  return RISK_BANDS.indexOf(band) >= RISK_BANDS.indexOf(threshold);
}

// ─── Periods ────────────────────────────────────────────────────────────────────────

export interface Period {
  /** Inclusive lower bound, epoch ms. */
  fromMs: number;
  /** Inclusive upper bound, epoch ms. */
  toMs: number;
}

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function instantOf(iso: string, label: string, endOfDay: boolean): number {
  if (typeof iso !== 'string' || iso.length === 0) {
    throw new Error(`"${label}" must be an ISO date string`);
  }
  // A bare date names a whole day, not its first instant. Resolving `to` to midnight is the
  // classic off-by-one that makes a Q1 report silently drop everything that happened on
  // 31 March - in this dataset, an evening gym check-in. So a date-only upper bound is
  // widened to the end of that day; a bound that already carries a time is taken literally.
  const text = ISO_DATE_ONLY.test(iso)
    ? `${iso}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : iso;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error(`"${label}" is not a parseable ISO date: ${iso}`);
  return ms;
}

export function periodOf(from: string, to: string): Period {
  const fromMs = instantOf(from, 'from', false);
  const toMs = instantOf(to, 'to', true);
  if (toMs < fromMs) throw new Error(`period "from" (${from}) is after "to" (${to})`);
  return { fromMs, toMs };
}

export function inPeriod(iso: string, p: Period): boolean {
  const t = Date.parse(iso);
  return t >= p.fromMs && t <= p.toMs;
}

/**
 * The equal-length window immediately before `p`, with no gap and no overlap.
 *
 * "Versus last quarter" and "versus the same quarter last year" are both defensible
 * comparisons, but they answer different questions, and a system that silently mixes them
 * produces trend numbers that never reconcile. This one commits to the first: the
 * immediately preceding window of identical length.
 */
export function precedingPeriod(p: Period): Period {
  const span = p.toMs - p.fromMs + 1;
  return { fromMs: p.fromMs - span, toMs: p.fromMs - 1 };
}

/**
 * `YYYY-MM` bucket, taken by slicing the ISO string rather than constructing a Date.
 *
 * Deliberate: `new Date(iso).getMonth()` is local-timezone dependent, so the same dataset
 * would bucket differently in Sydney and in London, and the verifier's recomputation could
 * disagree with the original run on a machine in another timezone. String slicing cannot.
 */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Inclusive list of `YYYY-MM` keys spanning a period, so a monthly series can be dense. */
export function monthsBetween(p: Period): string[] {
  const start = new Date(p.fromMs);
  const end = new Date(p.toMs);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  const out: string[] = [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    if (++m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

// ─── Numbers ────────────────────────────────────────────────────────────────────────

/** Money and rates report to cents / hundredths. Anything finer is false precision here. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Percentage *points* (12.5 means 12.5%), matching how the verifier parses "12.5%".
 *
 * A change measured against a zero baseline is undefined - not zero, not infinite.
 * Returning a number there would be exactly the kind of confident fabrication this
 * architecture exists to prevent, so the tool refuses and the assistant has to say so.
 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) {
    throw new Error(
      'percent change is undefined: the preceding period has a baseline of zero',
    );
  }
  return round2(((current - previous) / previous) * 100);
}

export function percentOf(part: number, whole: number, what: string): number {
  if (whole === 0) throw new Error(`percentage is undefined: no ${what} in scope`);
  return round2((part / whole) * 100);
}

// ─── Runtime guards ─────────────────────────────────────────────────────────────────
// Params arrive from a language model, so they are untrusted at runtime even though they
// are typed at compile time. These fail loudly rather than letting a bad argument become a
// NaN that flows silently into a receipt.

export function isoDate(v: unknown, label: string): string {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    throw new Error(`"${label}" must be an ISO date string, received ${JSON.stringify(v)}`);
  }
  return v;
}

export function requiredString(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`"${label}" is required and must be a non-empty string`);
  }
  return v;
}

export function optionalOneOf<T extends string>(
  v: unknown,
  label: string,
  allowed: readonly T[],
): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new Error(`"${label}" must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

/**
 * A choice the caller must actually make.
 *
 * Used where quietly substituting a default would answer a different question than the one
 * asked - "which facility" and "which risk band" have no safe fallback, and a tool that
 * guessed would hand back a confidently wrong number with a receipt attached.
 */
export function requiredOneOf<T extends string>(
  v: unknown,
  label: string,
  allowed: readonly T[],
): T {
  const value = optionalOneOf(v, label, allowed);
  if (value === undefined) {
    throw new Error(`"${label}" is required and must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

/** A choice with a safe default, applied when the caller omits it. */
export function oneOf<T extends string>(
  v: unknown,
  label: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return optionalOneOf(v, label, allowed) ?? fallback;
}

export function positiveInt(v: unknown, label: string, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(`"${label}" must be a positive integer`);
  }
  return v;
}

export function hourOrUndefined(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 24) {
    throw new Error(`"${label}" must be a whole hour between 0 and 24`);
  }
  return v;
}

// ─── Reusable param specs ───────────────────────────────────────────────────────────

export const FROM_PARAM = {
  type: 'string',
  description: 'Inclusive start of the period, ISO date (YYYY-MM-DD).',
  required: true,
} satisfies ToolParamSpec;

export const TO_PARAM = {
  type: 'string',
  description:
    'Inclusive end of the period, ISO date (YYYY-MM-DD). The whole of this day is included.',
  required: true,
} satisfies ToolParamSpec;
