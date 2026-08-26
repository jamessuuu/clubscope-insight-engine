import { getDataset } from '../data/index.js';
import type { ClubDataset } from '../domain/types.js';
import { TOOL_REGISTRY, type Evidence } from '../tools/index.js';
import { verifyNarrative } from '../verify/verifier.js';
import { DETECTORS } from './detectors.js';
import type { DetectorContext, Insight, InsightSeverity } from './types.js';

export { DETECTORS } from './detectors.js';
export type { DetectedInsight, Detector } from './detectors.js';
export {
  formatCount,
  formatPercent,
  formatUsd,
  narratableDetectors,
  narrate,
} from './narrate.js';
export type { EvidenceByKey, Narration, NarrationFacts } from './narrate.js';
export type {
  DetectorContext,
  Insight,
  InsightKind,
  InsightSeverity,
  SuggestedAction,
} from './types.js';

/**
 * The insight feed.
 *
 * Three stages, in this order and for this reason:
 *
 * 1. **Detect.** Deterministic code decides what is true, or decides nothing at all. The
 *    feed is allowed to come back empty; a quiet club should produce a quiet screen.
 * 2. **Narrate.** The detector's own evidence is turned into prose, with every figure
 *    carrying an `[[e:id|figure]]` citation. (That happens inside the detector, which owns
 *    the facts; this module owns what happens next.)
 * 3. **Verify.** Every cited figure is recomputed from source by `verifyNarrative` and
 *    compared against what the prose actually says. Nothing reaches a caller without that
 *    report attached.
 *
 * The stages are separate on purpose. Detection is testable against a fixture where the
 * right answer is known; narration is swappable for a model without touching anything else;
 * verification is a gate that fails closed and knows nothing about either.
 */

// ─── Ordering ───────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  elevated: 1,
  informational: 2,
};

/**
 * The dollars behind an insight, used only for ranking.
 *
 * Read off the evidence already gathered — the largest USD figure the insight computed —
 * rather than derived fresh, because a ranking key that is not itself a receipt would be a
 * number this system cannot show its working for. It is deliberately never rendered: it is
 * an ordering heuristic, not a claim, and the distinction is the reason it stays in here.
 */
function dollarWeight(evidence: readonly Evidence[]): number {
  let weight = 0;
  for (const e of evidence) {
    if (e.unit !== 'usd' || e.value.kind !== 'scalar') continue;
    weight = Math.max(weight, Math.abs(e.value.n));
  }
  return weight;
}

// ─── The feed ───────────────────────────────────────────────────────────────────────

/**
 * Runs every detector, verifies what fired, and returns the feed in reading order.
 *
 * ## Why a blocked insight is returned rather than dropped
 *
 * A blocked insight means the narrative claimed a figure its own evidence does not support.
 * Silently filtering those out would make the feed *look* perfect while hiding the single
 * most important signal the system produces — that something in the pipeline is lying — and
 * the guarantee would quietly become "we only show you what happened to agree". So blocked
 * insights come back, carrying the failing checks, and the UI renders the blocked state that
 * the spec calls for. The tests assert that none are blocked; the code does not assume it.
 */
export function detectInsights(
  ds: ClubDataset = getDataset(),
  ctx: DetectorContext = { now: ds.club.dataTo },
): Insight[] {
  const insights: Insight[] = [];

  for (const detector of DETECTORS) {
    const detected = detector.run(ds, ctx);
    if (detected === null) continue;

    // Keyed by id, matching how the narrative cites them. Building the map here rather than
    // inside the detector keeps the detector unable to hand the verifier an evidence record
    // it did not also attach to the insight for the reader to click through.
    const evidence = new Map(detected.evidence.map((e) => [e.id, e]));

    insights.push({
      ...detected,
      verification: verifyNarrative({
        narrative: detected.narrative,
        evidence,
        dataset: ds,
        tools: TOOL_REGISTRY,
      }),
    });
  }

  // Severity first, then money, then the register's editorial order. The last term is what
  // makes the feed reproducible: without a total order two equally severe, equally expensive
  // findings could swap places between runs and the determinism test would flap for no
  // reason a reader would ever be able to explain.
  const editorialOrder = new Map(DETECTORS.map((d, i) => [d.id, i]));
  return insights.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      dollarWeight(b.evidence) - dollarWeight(a.evidence) ||
      (editorialOrder.get(a.detector) ?? 0) - (editorialOrder.get(b.detector) ?? 0) ||
      a.id.localeCompare(b.id),
  );
}
