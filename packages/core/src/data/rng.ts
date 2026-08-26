/**
 * Deterministic pseudo-random source.
 *
 * ## Why this exists instead of `Math.random()`
 *
 * Three separate parts of this prototype break the moment the dataset can change between
 * runs:
 *
 * 1. **The demo.** A screenshot, a recorded assistant transcript and the live app must
 *    agree. "Dining revenue fell 22% in February" cannot be true on Tuesday and false on
 *    Thursday, or the whole grounding argument collapses in front of the person watching.
 * 2. **The eval suite.** Golden cases assert on specific figures. A shifting fixture turns
 *    every regression run into a coin flip, which is worse than having no evals at all
 *    because it teaches you to ignore red.
 * 3. **The verifier.** Its entire job is to re-execute a computation and compare the result
 *    to what the narrative claimed. Re-execution is only meaningful over a stable dataset.
 *
 * So the generator is a pure function of a single integer seed, and the only source of
 * variation in it is this class. No `Date.now()`, no `Math.random()`, no `Set` iteration
 * over externally-ordered keys. Same seed in, byte-identical dataset out, forever.
 *
 * ## Why mulberry32
 *
 * A 32-bit state PRNG with a single-line update step: fully specified by the code below, so
 * it cannot drift with a dependency upgrade the way a seeded library could. Its statistical
 * quality is far beyond what synthetic club data needs — we are shaping distributions, not
 * doing cryptography or Monte Carlo pricing. Reproducibility is the requirement; entropy
 * quality is not.
 */
export class Rng {
  /** 32-bit unsigned state. Kept private so a caller cannot accidentally fork the stream. */
  #state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new TypeError(`Rng seed must be a finite number, received ${String(seed)}`);
    }
    // `>>> 0` coerces to uint32 so that negative and fractional seeds still land on a
    // well-defined state rather than silently producing NaN on the first update.
    this.#state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] — inclusive at both ends, which is what call sites read as. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`Rng.int called with max ${max} below min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  bool(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    // An empty pool is a generator bug, not a data condition. Throwing here surfaces it at
    // the call site; a non-null assertion would push a confusing `undefined` downstream.
    if (item === undefined) {
      throw new RangeError('Rng.pick called on an empty array');
    }
    return item;
  }

  /**
   * Picks by relative weight. Weights need not sum to 1 — they are relative, so call sites
   * can express "twice as likely" without renormalising every time a branch is added.
   */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of entries) {
      if (w < 0) throw new RangeError('Rng.weighted received a negative weight');
      total += w;
    }
    if (total <= 0) throw new RangeError('Rng.weighted requires at least one positive weight');

    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll < 0) return value;
    }
    // Reached only through floating-point accumulation at the very top of the range.
    const last = entries[entries.length - 1];
    if (last === undefined) throw new RangeError('Rng.weighted called with no entries');
    return last[0];
  }

  /**
   * Box–Muller normal deviate.
   *
   * The standard implementation caches the second (independent) deviate for the next call.
   * We deliberately discard it: caching makes the number of draws consumed per call depend
   * on how many times the method was called earlier, which turns a reordering of unrelated
   * generation code into a silent, whole-dataset diff. Burning one extra draw buys the
   * property that every `normal()` call costs exactly two — much easier to reason about
   * when tuning the generator.
   */
  normal(mean: number, sd: number): number {
    // `1 - next()` keeps the argument to log() inside (0, 1]; log(0) would give -Infinity.
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal deviate clamped to a range — the common case when generating money and counts. */
  normalClamped(mean: number, sd: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, this.normal(mean, sd)));
  }

  /** Fisher–Yates on a copy. Returns a new array; the input is never mutated. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) continue;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}

/**
 * Weighted sampling *without* replacement, via the Efraimidis–Spirakis one-pass algorithm:
 * give each item the key `-ln(u) / w` and take the `k` smallest.
 *
 * Used wherever the generator needs to choose a fixed number of members — who resigns this
 * year, who registers for an event — with realistic bias (short-tenure members churn more,
 * engaged members sign up more) while still hitting an exact quota. Naive independent
 * coin-flips per member would hit the quota only on average, which makes planted ground
 * truth (like "the Q1-2025 cohort churns at double the rate") a matter of luck rather than
 * design.
 */
export function weightedSampleWithoutReplacement<T>(
  rng: Rng,
  items: readonly T[],
  weightOf: (item: T) => number,
  k: number,
): T[] {
  if (k <= 0) return [];
  const keyed = items.map((item) => {
    const w = Math.max(1e-9, weightOf(item));
    return { item, key: -Math.log(1 - rng.next()) / w };
  });
  keyed.sort((a, b) => a.key - b.key);
  return keyed.slice(0, Math.min(k, keyed.length)).map((entry) => entry.item);
}
