/**
 * Rounding-aware numeric comparison.
 *
 * A naive verifier fails the moment a model writes "$1.2M" for 1,241,880 — technically a
 * mismatch, journalistically correct. Rejecting that trains the model toward unreadable
 * prose. Accepting any nearby number lets real fabrication through.
 *
 * The resolution: infer the *precision* the writer claimed from how the number is written,
 * then accept the figure only if the true value lies inside the interval that rounds to it.
 * "$1.2M" asserts a value in [1.15M, 1.25M). "1,241,880" asserts a value in [1241879.5,
 * 1241880.5). Both are honest at their stated precision, and both are checkable.
 */

export interface ParsedFigure {
  /** The literal text as written. */
  raw: string;
  /** Numeric value in base units (dollars, percentage points, count). */
  value: number;
  /**
   * The size of one unit in the last significant place — the rounding step. A value of
   * 100000 means the writer rounded to the nearest 100,000.
   */
  step: number;
  /** Detected unit hint from the text itself, when present. */
  unitHint: 'usd' | 'percent' | 'none';
}

const MAGNITUDES: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  b: 1e9,
};

/**
 * Parses a single written figure. Returns null when the text is not a figure at all.
 *
 * Handles: 1234, 1,234, 1.2, $1,234.50, 62%, 1.2M, 340k, -12%.
 */
export function parseFigure(raw: string): ParsedFigure | null {
  const text = raw.trim();
  const m = /^(-?)\s*(\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|K|m|M|bn|BN|b|B)?\s*(%)?$/.exec(text);
  if (!m) return null;

  const [, sign, dollar, digits, magRaw, pct] = m;
  const mag = magRaw ? MAGNITUDES[magRaw.toLowerCase()] : 1;
  if (magRaw && mag === undefined) return null;

  const plain = digits.replace(/,/g, '');
  if (plain === '' || plain === '.') return null;
  const base = Number(plain);
  if (!Number.isFinite(base)) return null;

  // Decimal places actually written determine the claimed precision.
  const dot = plain.indexOf('.');
  const decimals = dot === -1 ? 0 : plain.length - dot - 1;
  // One unit in the last written place, scaled by any magnitude suffix.
  const step = Math.pow(10, -decimals) * mag;

  const value = (sign === '-' ? -1 : 1) * base * mag;

  return {
    raw: text,
    value,
    step,
    unitHint: pct ? 'percent' : dollar ? 'usd' : 'none',
  };
}

/**
 * True when `actual` is a value that legitimately rounds to the written figure.
 *
 * Uses a half-step interval, widened by a hair of floating-point slack. Exact integers
 * written at full precision therefore demand an exact match, which is what we want for
 * counts: "47 members" must mean 47.
 */
export function roundsTo(figure: ParsedFigure, actual: number): boolean {
  const half = figure.step / 2;
  const slack = Math.max(Math.abs(actual), Math.abs(figure.value)) * 1e-9;
  return Math.abs(actual - figure.value) <= half + slack;
}

/** Finds every figure-shaped token in prose, with its position. */
export function findFigures(prose: string): Array<ParsedFigure & { index: number }> {
  const out: Array<ParsedFigure & { index: number }> = [];
  const re = /-?\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|m|M|bn|BN|b|B)?\s*%?/g;
  for (const match of prose.matchAll(re)) {
    const parsed = parseFigure(match[0]);
    if (parsed) out.push({ ...parsed, index: match.index ?? 0 });
  }
  return out;
}

/**
 * Figures that carry no analytical claim and so are exempt from citation.
 *
 * Kept deliberately tight: bare four-digit years, and small ordinals used in ordinary
 * sentence construction ("the top 3"). Everything else must cite. A permissive allowlist
 * here would quietly defeat the entire verifier, so it is enumerated, not heuristic.
 */
export function isExemptFigure(f: ParsedFigure): boolean {
  const isBareInt = f.unitHint === 'none' && Number.isInteger(f.value) && f.step === 1;
  if (!isBareInt) return false;
  const isYear = f.value >= 1900 && f.value <= 2100 && !f.raw.includes(',');
  const isSmallOrdinal = f.value >= 0 && f.value <= 12;
  return isYear || isSmallOrdinal;
}
