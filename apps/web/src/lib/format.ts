/**
 * Deterministic formatters.
 *
 * Everything here is hand-rolled rather than delegated to `Intl`, because these strings are
 * produced on the server and again during hydration on the client. `Intl` resolves against
 * whatever ICU data and timezone each side happens to have, and the one place that bites is
 * exactly the place it matters here: a currency figure or a date that renders differently in
 * the two passes is a React hydration mismatch on the number the whole product asks you to
 * trust. Explicit arithmetic cannot drift.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function thousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Fixed-decimal number with thousands separators. */
export function num(n: number, decimals = 0): string {
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  const body = frac === undefined ? thousands(whole) : `${thousands(whole)}.${frac}`;
  return negative ? `-${body}` : body;
}

export function usd(n: number, decimals = 0): string {
  return `${n < 0 ? '-' : ''}$${num(Math.abs(n), decimals)}`;
}

/**
 * Money at the precision a person would actually say out loud. The verifier is
 * rounding-aware, so "$381k" is a legitimate way to cite 381,204 — it asserts a value in
 * [380.5k, 381.5k) and that assertion is checked like any other.
 */
export function usdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${num(abs / 1_000_000, 1)}M`;
  if (abs >= 10_000) return `${sign}$${num(Math.round(abs / 1_000))}k`;
  return `${sign}$${num(abs)}`;
}

export function pct(n: number, decimals = 1): string {
  return `${num(n, decimals)}%`;
}

export function signedPct(n: number, decimals = 1): string {
  return `${n > 0 ? '+' : ''}${num(n, decimals)}%`;
}

/** `2026-08-31` or an ISO instant → `31 Aug 2026`. Parsed as UTC, always. */
export function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `2026-08-31T14:05:00Z` → `31 Aug 2026, 14:05 UTC`. */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${shortDate(iso)}, ${hh}:${mm} UTC`;
}

/** `2026-08` → `Aug 26`. Used on chart axes where space is scarce. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  if (!MONTHS[idx]) return ym;
  return `${MONTHS[idx]} ${y.slice(2)}`;
}

/** Whole years between two ISO dates, to one decimal. */
export function yearsBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Math.round((ms / 86_400_000 / 365.25) * 10) / 10;
}

/** Days between two ISO dates, floored. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Shifts an ISO date-only string by whole days, staying in UTC. */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `full-golf` → `Full golf`. Category and facility ids are kebab-case throughout. */
export function humanise(slug: string): string {
  const spaced = slug.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Joins class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
