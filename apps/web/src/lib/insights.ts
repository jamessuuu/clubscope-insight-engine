import { detectInsights } from '@clubscope/core/insights';
import type { Insight } from '@clubscope/core/insights';
import { club } from './club';
import { once } from './once';

/**
 * The insight feed.
 *
 * Detection lives entirely in core: deterministic detectors with stated thresholds, so the
 * feed is regression-testable and a quiet week produces an empty feed rather than an invented
 * trend. Core also owns the ordering — severity, then dollars at stake, then a fixed
 * editorial tiebreak — and this module deliberately does not re-sort. A second opinion about
 * ranking applied here would silently discard the money term and make the feed's order
 * depend on which layer ran last.
 *
 * The context is pinned to the dataset's own end date rather than the wall clock. The data is
 * a closed historical record ending on `dataTo`; detecting "as at today" against it would age
 * every 90-day window straight out of the data.
 */
export const rankedInsights = once((): Insight[] => {
  const ds = club();
  return detectInsights(ds, { now: ds.club.dataTo });
});
