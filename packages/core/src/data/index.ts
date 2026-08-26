/**
 * The dataset the whole prototype runs against.
 *
 * Everything downstream - the analysis tools, the verifier, the churn model, the assistant's
 * replay transcripts and the eval suite - reads from `getDataset()`. Keeping a single
 * accessor rather than passing a dataset around from a composition root is a deliberate
 * trade for a demo of this size: it means an eval case, a Next.js server component and a
 * unit test are provably looking at the same rows, which is the property the grounding
 * argument depends on.
 */
import { generateDataset } from './generate.js';
import type { ClubDataset } from '../domain/types.js';

export { generateDataset, PLANTED_ANOMALIES } from './generate.js';
export type { PlantedAnomaly, PlantedAnomalyKind } from './generate.js';
export { Rng, weightedSampleWithoutReplacement } from './rng.js';

/**
 * The seed the demo, the recorded transcripts and the eval baselines are all pinned to.
 *
 * Changing this number invalidates every recorded assistant transcript and every eval
 * expectation in one move, so it is treated as part of the public contract of this package
 * rather than as a tuning knob.
 */
export const DEFAULT_SEED = 20_260_901;

let cached: ClubDataset | null = null;

/**
 * The memoised dataset.
 *
 * Generation walks ~420 members across 730 days and produces roughly 120,000 rows, which is
 * cheap once and wasteful on every request. Module-level memoisation is safe here precisely
 * because generation is pure and every consumer treats the dataset as immutable - there is
 * no request-scoped state to leak between callers.
 */
export function getDataset(): ClubDataset {
  if (cached === null) {
    cached = generateDataset(DEFAULT_SEED);
  }
  return cached;
}

/**
 * Drops the memoised dataset. Exists for tests that need to prove generation is repeatable;
 * production code should never need it.
 */
export function resetDatasetCache(): void {
  cached = null;
}
